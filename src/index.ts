import Docker, { Container, ContainerInfo } from 'dockerode';
import config from './config';
import TelegramBot from 'node-telegram-bot-api';
import * as Buffer from 'buffer';
import Stream from 'stream';

type Event = {
    id: string;
    from: string;
}

class LogListener {
    docker: Docker;
    containerIds: string[];
    logStreams: Stream.Readable[];
    telegramBot: TelegramBot;

    constructor(docker: Docker, telegramBot: TelegramBot, containerIds: string[], logStreams: Stream.Readable[]) {
      this.docker = docker;
      this.containerIds = containerIds;
      this.logStreams = logStreams;
      this.telegramBot = telegramBot;
    }

    static async notify(containerName: string, log: string, telegramBot: TelegramBot) {
        await telegramBot.sendMessage(
            config.telegramChatId,
            `*Error in service ${containerName}*`,
            { parse_mode: 'Markdown' }
        );
        await telegramBot.sendMessage(config.telegramChatId, log);
        console.log(`Successfully notified about error in "${containerName}"`)
    }

    private static registerDataListener(containerName: string, stream: Stream.Readable, telegramBot: TelegramBot) {
        stream.on('data', (buffer: Buffer) => {
            const log = buffer.toString();

            if (log.toLowerCase().indexOf('error') === -1) {
                return;
            }

            console.log(`Error in container "${containerName}". Notifying...`);

            if (config.enableTelegram !== 'TRUE') {
                return;
            }

            LogListener.notify(containerName, log, telegramBot).catch(console.error);
        });
        stream.once('destroy', () => { console.log(`Stream for ${containerName} is destroyed`) })
        stream.once('close', () => { console.log(`Stream for ${containerName} is closed`) })
    }

    private static registerDataListeners(containerInfos: ContainerInfo[], logStreams: Stream.Readable[], telegramBot: TelegramBot) {
        logStreams.forEach((stream, index) => {
            const containerName = containerInfos[index].Image;
            LogListener.registerDataListener(containerName, stream, telegramBot);
        });
    }

    private static async getLogStreams(docker: Docker, containerInfos: ContainerInfo[]) {
        const logPromises = containerInfos.map((containerInfo: ContainerInfo) => {
            const container = docker.getContainer(containerInfo.Id);
            return container.logs({
                timestamps: true,
                stdout: true,
                stderr: true,
                tail: 0,
                follow: true,
            });
        });

        return await Promise.all(logPromises);
    }

    static async create(docker: Docker, telegramBot: TelegramBot) {
        console.log(`Initializing log listener...`);

        const allContainerInfos = await docker.listContainers();
        const containerInfos = allContainerInfos.filter((container) => container.Image !== 'refruity/error-notifier');
        const containerIds = containerInfos.map((info) => info.Id);

        console.log(`Found ${containerInfos.length} containers.`);
        console.log(containerInfos.map((container) => container.Image).join('\n'));

        const logStreams = await LogListener.getLogStreams(docker, containerInfos) as Stream.Readable[];

        LogListener.registerDataListeners(containerInfos, logStreams, telegramBot);

        console.log('Registered error listeners.');

        return new LogListener(docker, telegramBot, containerIds, logStreams);
    }

    private async onDockerEventStart(event: Event) {
        const containerName = event.from;
        console.log(`Registering new listener for container "${containerName}"`);
        this.containerIds.push(event.id);
        const container = this.docker.getContainer(event.id);
        const logStream = await container.logs({
            timestamps: true,
            stdout: true,
            stderr: true,
            tail: 0,
            follow: true,
        }) as Stream.Readable;
        LogListener.registerDataListener(containerName, logStream, this.telegramBot);
        this.logStreams.push(logStream);
        console.log(`New listener for container "${containerName}" successfully registered`);
    }

    private async onDockerEventStop(event: Event) {
        const containerName = event.from;
        const index = this.containerIds.findIndex((id) => id === event.id);

        if (index === -1) {
            console.log(`No listener for container "${containerName}" found`);
            return;
        }

        console.log(`Removing listener for container "${containerName}"`);

        this.logStreams[index].destroy();
        this.logStreams.splice(index, 1);
        this.containerIds.splice(index, 1);

        console.log(`Listener for container "${containerName}" successfully removed`)
    }

    private async onDockerEvent(buffer: Buffer) {
        const eventString = buffer.toString();
        const event = JSON.parse(eventString);
        if (event.status === 'start') {
            await this.onDockerEventStart(event);
        } else if (event.status === 'stop') {
            await this.onDockerEventStop(event);
        }
    }

    async watchContainerOperations() {
        const eventStream = await this.docker.getEvents({ filters: { type: ['container'] } });
        eventStream.on('data', (buffer: Buffer) => {
            this.onDockerEvent(buffer).catch(console.error);
        });
    }
}

async function run() {
    const docker = new Docker({ socketPath: config.dockerSocketPath });
    const telegramBot = new TelegramBot(config.telegramBotToken);

    const logListener = await LogListener.create(docker, telegramBot);
    await logListener.watchContainerOperations();

    if (config.enableTelegram === 'TRUE') {
        await telegramBot.sendMessage(config.telegramChatId, 'Error notifier successfully deployed!');
    }
}

run().catch(console.error);
