import dotenv from 'dotenv';

dotenv.config();

export default {
    dockerSocketPath: process.env.DOCKER_SOCKET_PATH ?? '/var/run/docker.sock',
    telegramBotToken: process.env.TELEGRAM_BOT_TOKEN ?? '12345',
    telegramChatId: process.env.TELEGRAM_CHAT_ID ?? '12345',
    enableTelegram: process.env.ENABLE_TELEGRAM ?? 'TRUE',
}
