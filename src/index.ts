import Docker from 'dockerode'
import config from './config'
import TelegramBot from 'node-telegram-bot-api'
import { LogListener } from './log-listener'

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
