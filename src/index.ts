import Docker, { ContainerInfo } from 'dockerode';
import config from './config';
import TelegramBot from 'node-telegram-bot-api';

const docker = new Docker({ socketPath: config.dockerSocketPath });
const telegramBot = new TelegramBot(config.telegramBotToken);

async function listenLogs() {
    const containers = await docker.listContainers();

    console.log(`Found ${containers.length} containers.`)
    console.log(containers.map((container) => container.Image).join('\n'))

    const logPromises = containers.map((containerInfo: ContainerInfo) => {
        const container = docker.getContainer(containerInfo.Id);
        return container.logs({
            timestamps: true,
            stdout: true,
            stderr: true,
            tail: 0,
            follow: true,
        });
    });

    const logStreams = await Promise.all(logPromises);

    logStreams.forEach((stream, index) => {
        stream.on('data', (buffer: Buffer) => {
            const log = buffer.toString();

            if (log.toLowerCase().indexOf('error') !== -1) {
                const serviceName = containers[index].Image
                telegramBot.sendMessage(
                    config.telegramChatId,
                    `*Error in service ${serviceName}*`,
                    { parse_mode: 'Markdown' }
                ).then(() => telegramBot.sendMessage(config.telegramChatId, log)).catch(console.error);
            }
        });
    });

    console.log('Registered error listeners.')
}

async function run() {
    await listenLogs();
    await telegramBot.sendMessage(config.telegramChatId, 'Error notifier successfully deployed!');
}

run().catch(console.error);
