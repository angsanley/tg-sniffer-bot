import { Bot, type Context, type GrammyError } from 'grammy'
import { type ChatMemberAdministrator } from 'grammy/types'
import NodeCache from 'node-cache'
import 'dotenv/config'

const bot = new Bot(process.env.BOT_TOKEN as string)

enum ErrorCode {
  NO_DELETE_MESSAGE_PERMISSION = 403,
  IS_PRIVATE_CHAT = 400,
}

const bannedWords = process.env.BANNED_WORDS?.split(',') ?? []

// ttl 1 hour, checkperiod 1 hour
const botChatMemberCache = new NodeCache({ stdTTL: 3600, checkperiod: 3600 })

const checkPermissionError = async (ctx: Context): Promise<(ErrorCode | boolean)> => {
  if (ctx.chat?.type === 'private') {
    return ErrorCode.IS_PRIVATE_CHAT
  }

  // check cache first
  let botChatMember: ChatMemberAdministrator | undefined = botChatMemberCache.get(ctx.chat?.id as NodeCache.Key)

  // if not in cache, get from telegram api
  if (botChatMember === undefined) {
    const chatId = ctx.chat?.id
    const botId = (await bot.api.getMe()).id

    // get permissions
    botChatMember = await bot.api.getChatMember(chatId as NodeCache.Key, botId) as ChatMemberAdministrator

    // save to cache
    botChatMemberCache.set(chatId as NodeCache.Key, botChatMember)

    // set ttl to 30 seconds if no permission
    if (!botChatMember.can_delete_messages) {
      botChatMemberCache.ttl(chatId as NodeCache.Key, 30)
    }
  }

  if (!botChatMember.can_delete_messages) {
    return ErrorCode.NO_DELETE_MESSAGE_PERMISSION
  }

  return false
}

const checkPermissionsAndSendMessage = async (ctx: Context): Promise<ReturnType<typeof checkPermissionError>> => {
  const error = await checkPermissionError(ctx)
  if (error !== undefined) {
    switch (error) {
      case ErrorCode.IS_PRIVATE_CHAT:
        await ctx.reply('This bot only works in groups.')
        return true
      case ErrorCode.NO_DELETE_MESSAGE_PERMISSION:
        await ctx.reply("I don't have permission to delete messages.")
        return true
    }
  }
  return error
}

// Reply to any message with "Hi there!".
bot.on('message', async (ctx) => {
  const error = await checkPermissionsAndSendMessage(ctx)
  if (error !== false) return

  // check message type, ignore non texts
  if (ctx.message.text === undefined) return

  // delete message
  const message = ctx.message.text.toLowerCase()

  // only match words
  const words = message.split(' ')
  const matchedWords = words.filter((word) => bannedWords.includes(word))

  if (matchedWords.length > 0) {
    try {
      await ctx.deleteMessage()
    } catch (err) {
      const grammyError = err as GrammyError
      if (grammyError.error_code === 400) {
        // maybe no permission, remove from cache
        botChatMemberCache.del(ctx.chat.id)
        await checkPermissionsAndSendMessage(ctx)
      }
      console.error(err)
    }
  }
})

bot.catch((err) => {
  console.error(err)
})

bot.start().then().catch(console.error)
