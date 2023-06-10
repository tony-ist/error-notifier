import Docker, { ContainerInfo } from 'dockerode'
import Stream from 'stream'
import TelegramBot from 'node-telegram-bot-api'
import { ShortContainerInfo, shortContainerInfoFromContainerInfo, shortContainerInfoFromEvent } from './short-container-info'
import config from './config'
import Buffer from 'buffer'
import { Event } from './types'

export class LogListener {
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

  static async notify(info: ShortContainerInfo, log: string, telegramBot: TelegramBot) {
    const containerId = info.id;
    const imageName = info.imageName;
    const messageLines = [`**** Error in container "${containerId}" with image "${imageName}" ****`];
    messageLines.push('');
    messageLines.push(log);
    await telegramBot.sendMessage(
      config.telegramChatId,
      messageLines.join('\n')
    );
    console.log(`Successfully notified about error in container "${containerId}" with image "${imageName}"`)
  }

  private static registerDataListener(info: ShortContainerInfo, stream: Stream.Readable, telegramBot: TelegramBot) {
    const containerId = info.id;
    const imageName = info.imageName;
    stream.on('data', (buffer: Buffer) => {
      const log = buffer.toString();

      if (log.toLowerCase().indexOf('error') === -1) {
        return;
      }

      console.log(`Error in container "${containerId}" with image "${imageName}". Notifying...`);

      if (config.enableTelegram !== 'TRUE') {
        return;
      }

      LogListener.notify(info, log, telegramBot).catch(console.error);
    });
    stream.once('destroy', () => { console.log(`Stream for container "${containerId}" with image "${imageName}" is destroyed`) })
    stream.once('close', () => { console.log(`Stream for container "${containerId}" with image "${imageName}" closed`) })
  }

  private static registerDataListeners(containerInfos: ContainerInfo[], logStreams: Stream.Readable[], telegramBot: TelegramBot) {
    logStreams.forEach((stream, index) => {
      // TODO: Remove debug print
      console.log(containerInfos[index]);
      LogListener.registerDataListener(shortContainerInfoFromContainerInfo(containerInfos[index]), stream, telegramBot);
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
    const shortContainerInfo = shortContainerInfoFromEvent(event);
    const imageName = shortContainerInfo.imageName;
    // TODO: Remove debug print
    console.log('event:', event)
    console.log(`Registering new listener for container with image "${imageName}"`);
    this.containerIds.push(event.id);
    const container = this.docker.getContainer(event.id);
    const logStream = await container.logs({
      timestamps: true,
      stdout: true,
      stderr: true,
      tail: 0,
      follow: true,
    }) as Stream.Readable;

    LogListener.registerDataListener(shortContainerInfo, logStream, this.telegramBot);
    this.logStreams.push(logStream);
    console.log(`New listener for container with image "${imageName}" successfully registered`);
  }

  private async onDockerEventStop(event: Event) {
    const shortContainerInfo = shortContainerInfoFromEvent(event);
    const containerId = shortContainerInfo.id;
    const imageName = shortContainerInfo.imageName;
    const index = this.containerIds.findIndex((id) => id === event.id);

    if (index === -1) {
      console.log(`No listener for container "${containerId}" with image "${imageName}" found`);
      return;
    }

    console.log(`Removing listener for container "${containerId}" with image "${imageName}"`);

    this.logStreams[index].destroy();
    this.logStreams.splice(index, 1);
    this.containerIds.splice(index, 1);

    console.log(`Listener for container "${containerId}" with image "${imageName}" successfully removed`)
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
