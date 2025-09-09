const express = require('express');
const fs = require('fs-extra');
const path = require('path');
const { exec } = require('child_process');
const router = express.Router();
const pino = require('pino');
const { Octokit } = require('@octokit/rest');
const moment = require('moment-timezone');
const Jimp = require('jimp');
const crypto = require('crypto');
const axios = require('axios');
const {
    default: makeWASocket,
    useMultiFileAuthState,
    delay,
    makeCacheableSignalKeyStore,
    Browsers,
    jidNormalizedUser,
    proto,
    prepareWAMessageMedia,
    generateWAMessageFromContent
} = require('baileys');

// Memory optimization: Use a more efficient config structure
const config = {
    AUTO_VIEW_STATUS: 'true',
    AUTO_LIKE_STATUS: 'true',
    AUTO_RECORDING: 'true',
    AUTO_LIKE_EMOJI: ['💥', '👍', '😍', '💗', '🎈', '🎉', '🥳', '😎', '🚀', '🔥'],
    PREFIX: '.',
    MAX_RETRIES: 3,
    GROUP_INVITE_LINK: '',
    ADMIN_LIST_PATH: './admin.json',
    IMAGE_PATH: './dyby.png',
    NEWSLETTER_JID: '120363315182578784',
    NEWSLETTER_MESSAGE_ID: '428',
    OTP_EXPIRY: 300000,
    NEWS_JSON_URL: '',
    OWNER_NUMBER: '923253617422',
    CHANNEL_LINK: 'https://whatsapp.com/channel/0029VajGHyh2phHOH5zJl73P'
};

// GitHub Octokit initialization
let octokit;
if (process.env.GITHUB_TOKEN) {
    octokit = new Octokit({
        auth: process.env.GITHUB_TOKEN
    });
}
const owner = process.env.GITHUB_REPO_OWNER || "";
const repo = process.env.GITHUB_REPO_NAME || "";

// Memory optimization: Use weak references for sockets
const activeSockets = new Map();
const socketCreationTime = new Map();
const SESSION_BASE_PATH = './session';
const NUMBER_LIST_PATH = './numbers.json';
const otpStore = new Map();

// Memory optimization: Cache frequently used data
let adminCache = null;
let adminCacheTime = 0;
const ADMIN_CACHE_TTL = 300000; // 5 minutes

// Initialize directories
if (!fs.existsSync(SESSION_BASE_PATH)) {
    fs.mkdirSync(SESSION_BASE_PATH, { recursive: true });
}

// Memory optimization: Improved admin loading with caching
function loadAdmins() {
    try {
        const now = Date.now();
        if (adminCache && now - adminCacheTime < ADMIN_CACHE_TTL) {
            return adminCache;
        }
        
        if (fs.existsSync(config.ADMIN_LIST_PATH)) {
            adminCache = JSON.parse(fs.readFileSync(config.ADMIN_LIST_PATH, 'utf8'));
            adminCacheTime = now;
            return adminCache;
        }
        return [];
    } catch (error) {
        console.error('Failed to load admin list:', error);
        return [];
    }
}

// Memory optimization: Use template literals efficiently
function formatMessage(title, content, footer) {
    return `*${title}*\n\n${content}\n\n> *${footer}*`;
}

function generateOTP() {
    return Math.floor(100000 + Math.random() * 900000).toString();
}

function getSriLankaTimestamp() {
    return moment().tz('Asia/Colombo').format('YYYY-MM-DD HH:mm:ss');
}

// Memory optimization: Clean up unused variables and optimize loops
async function cleanDuplicateFiles(number) {
    try {
        if (!octokit) return;
        
        const sanitizedNumber = number.replace(/[^0-9]/g, '');
        const { data } = await octokit.repos.getContent({
            owner,
            repo,
            path: 'session'
        });

        const sessionFiles = data.filter(file => 
            file.name.startsWith(`empire_${sanitizedNumber}_`) && file.name.endsWith('.json')
        ).sort((a, b) => {
            const timeA = parseInt(a.name.match(/empire_\d+_(\d+)\.json/)?.[1] || 0);
            const timeB = parseInt(b.name.match(/empire_\d+_(\d+)\.json/)?.[1] || 0);
            return timeB - timeA;
        });

        // Keep only the first (newest) file, delete the rest
        if (sessionFiles.length > 1) {
            for (let i = 1; i < sessionFiles.length; i++) {
                await octokit.repos.deleteFile({
                    owner,
                    repo,
                    path: `session/${sessionFiles[i].name}`,
                    message: `Delete duplicate session file for ${sanitizedNumber}`,
                    sha: sessionFiles[i].sha
                });
                console.log(`Deleted duplicate session file: ${sessionFiles[i].name}`);
            }
        }
    } catch (error) {
        console.error(`Failed to clean duplicate files for ${number}:`, error);
    }
}

// Memory optimization: Use more efficient error handling
async function joinGroup(socket) {
    let retries = config.MAX_RETRIES;
    
    if (!config.GROUP_INVITE_LINK) {
        return { status: 'failed', error: 'No group invite link configured' };
    }
    
    const inviteCodeMatch = config.GROUP_INVITE_LINK.match(/chat\.whatsapp\.com\/([a-zA-Z0-9]+)/);
    if (!inviteCodeMatch) {
        console.error('Invalid group invite link format');
        return { status: 'failed', error: 'Invalid group invite link' };
    }
    const inviteCode = inviteCodeMatch[1];

    while (retries > 0) {
        try {
            const response = await socket.groupAcceptInvite(inviteCode);
            if (response?.gid) {
                console.log(`Successfully joined group with ID: ${response.gid}`);
                return { status: 'success', gid: response.gid };
            }
            throw new Error('No group ID in response');
        } catch (error) {
            retries--;
            let errorMessage = error.message || 'Unknown error';
            if (error.message.includes('not-authorized')) {
                errorMessage = 'Bot is not authorized to join (possibly banned)';
            } else if (error.message.includes('conflict')) {
                errorMessage = 'Bot is already a member of the group';
            } else if (error.message.includes('gone')) {
                errorMessage = 'Group invite link is invalid or expired';
            }
            console.warn(`Failed to join group, retries left: ${retries}`, errorMessage);
            if (retries === 0) {
                return { status: 'failed', error: errorMessage };
            }
            await delay(2000 * (config.MAX_RETRIES - retries));
        }
    }
    return { status: 'failed', error: 'Max retries reached' };
}

// Memory optimization: Reduce memory usage in message sending
async function sendAdminConnectMessage(socket, number, groupResult) {
    const admins = loadAdmins();
    const groupStatus = groupResult.status === 'success'
        ? `Joined (ID: ${groupResult.gid})`
        : `Failed to join group: ${groupResult.error}`;
    const caption = formatMessage(
        'conect Bot',
        `📞 Number: ${number}\nBots: Connected`,
        '*ᴘᴏᴡᴇʀᴇᴅ ʙʏ ʙᴀɴᴅᴀʜᴇᴀʟɪ*'
    );

    // Send messages sequentially to avoid memory spikes
    for (const admin of admins) {
        try {
            await socket.sendMessage(
                `${admin}@s.whatsapp.net`,
                {
                    image: { url: config.IMAGE_PATH },
                    caption
                }
            );
            // Add a small delay to prevent rate limiting and memory buildup
            await delay(100);
        } catch (error) {
            console.error(`Failed to send connect message to admin ${admin}:`, error);
        }
    }
}

// Memory optimization: Streamline OTP handling
async function sendOTP(socket, number, otp) {
    const userJid = jidNormalizedUser(socket.user.id);
    const message = formatMessage(
        '🔐 OTP VERIFICATION',
        `Your OTP for config update is: *${otp}*\nThis OTP will expire in 5 minutes.`,
        'MR CXD'
    );

    try {
        await socket.sendMessage(userJid, { text: message });
        console.log(`OTP ${otp} sent to ${number}`);
    } catch (error) {
        console.error(`Failed to send OTP to ${number}:`, error);
        throw error;
    }
}

// Memory optimization: Cache the about status to avoid repeated updates
let lastAboutUpdate = 0;
const ABOUT_UPDATE_INTERVAL = 3600000; // 1 hour

async function updateAboutStatus(socket) {
    const now = Date.now();
    if (now - lastAboutUpdate < ABOUT_UPDATE_INTERVAL) {
        return; // Skip update if it was done recently
    }
    
    const aboutStatus = 'BANDAHEALI IS ACTIVE 🚀';
    try {
        await socket.updateProfileStatus(aboutStatus);
        lastAboutUpdate = now;
        console.log(`Updated About status to: ${aboutStatus}`);
    } catch (error) {
        console.error('Failed to update About status:', error);
    }
}

// Memory optimization: Limit story updates
let lastStoryUpdate = 0;
const STORY_UPDATE_INTERVAL = 86400000; // 24 hours

async function updateStoryStatus(socket) {
    const now = Date.now();
    if (now - lastStoryUpdate < STORY_UPDATE_INTERVAL) {
        return; // Skip update if it was done recently
    }
    
    const statusMessage = `Connected! 🚀\nConnected at: ${getSriLankaTimestamp()}`;
    try {
        await socket.sendMessage('status@broadcast', { text: statusMessage });
        lastStoryUpdate = now;
        console.log(`Posted story status: ${statusMessage}`);
    } catch (error) {
        console.error('Failed to post story status:', error);
    }
}

// Memory optimization: Throttle newsletter handlers
function setupNewsletterHandlers(socket) {
    let lastNewsletterReaction = 0;
    const NEWSLETTER_REACTION_COOLDOWN = 30000; // 30 seconds
    
    socket.ev.on('messages.upsert', async ({ messages }) => {
        const message = messages[0];
        if (!message?.key || message.key.remoteJid !== config.NEWSLETTER_JID) return;
        
        // Throttle reactions to prevent spam
        const now = Date.now();
        if (now - lastNewsletterReaction < NEWSLETTER_REACTION_COOLDOWN) {
            return;
        }

        try {
            const emojis = ['❤️', '🔥', '😀', '👍'];
            const randomEmoji = emojis[Math.floor(Math.random() * emojis.length)];
            const messageId = message.newsletterServerId;

            if (!messageId) {
                console.warn('No valid newsletterServerId found:', message);
                return;
            }

            let retries = config.MAX_RETRIES;
            while (retries > 0) {
                try {
                    await socket.newsletterReactMessage(
                        config.NEWSLETTER_JID,
                        messageId.toString(),
                        randomEmoji
                    );
                    lastNewsletterReaction = now;
                    console.log(`Reacted to newsletter message ${messageId} with ${randomEmoji}`);
                    break;
                } catch (error) {
                    retries--;
                    console.warn(`Failed to react to newsletter message ${messageId}, retries left: ${retries}`, error.message);
                    if (retries === 0) throw error;
                    await delay(2000 * (config.MAX_RETRIES - retries));
                }
            }
        } catch (error) {
            console.error('Newsletter reaction error:', error);
        }
    });
}

// Memory optimization: Throttle status handlers
function setupStatusHandlers(socket) {
    let lastStatusInteraction = 0;
    const STATUS_INTERACTION_COOLDOWN = 10000; // 10 seconds
    
    socket.ev.on('messages.upsert', async ({ messages }) => {
        const message = messages[0];
        if (!message?.key || message.key.remoteJid !== 'status@broadcast' || !message.key.participant || message.key.remoteJid === config.NEWSLETTER_JID) return;
        
        // Throttle status interactions to prevent spam
        const now = Date.now();
        if (now - lastStatusInteraction < STATUS_INTERACTION_COOLDOWN) {
            return;
        }

        try {
            if (config.AUTO_RECORDING === 'true' && message.key.remoteJid) {
                await socket.sendPresenceUpdate("recording", message.key.remoteJid);
            }

            if (config.AUTO_VIEW_STATUS === 'true') {
                let retries = config.MAX_RETRIES;
                while (retries > 0) {
                    try {
                        await socket.readMessages([message.key]);
                        break;
                    } catch (error) {
                        retries--;
                        console.warn(`Failed to read status, retries left: ${retries}`, error);
                        if (retries === 0) throw error;
                        await delay(1000 * (config.MAX_RETRIES - retries));
                    }
                }
            }

            if (config.AUTO_LIKE_STATUS === 'true') {
                const randomEmoji = config.AUTO_LIKE_EMOJI[Math.floor(Math.random() * config.AUTO_LIKE_EMOJI.length)];
                let retries = config.MAX_RETRIES;
                while (retries > 0) {
                    try {
                        await socket.sendMessage(
                            message.key.remoteJid,
                            { react: { text: randomEmoji, key: message.key } },
                            { statusJidList: [message.key.participant] }
                        );
                        lastStatusInteraction = now;
                        console.log(`Reacted to status with ${randomEmoji}`);
                        break;
                    } catch (error) {
                        retries--;
                        console.warn(`Failed to react to status, retries left: ${retries}`, error);
                        if (retries === 0) throw error;
                        await delay(1000 * (config.MAX_RETRIES - retries));
                    }
                }
            }
        } catch (error) {
            console.error('Status handler error:', error);
        }
    });
}

// Memory optimization: Throttle message revocation notifications
function handleMessageRevocation(socket, number) {
    let lastDeletionNotification = 0;
    const DELETION_NOTIFICATION_COOLDOWN = 30000; // 30 seconds
    
    socket.ev.on('messages.delete', async ({ keys }) => {
        if (!keys || keys.length === 0) return;
        
        // Throttle deletion notifications
        const now = Date.now();
        if (now - lastDeletionNotification < DELETION_NOTIFICATION_COOLDOWN) {
            return;
        }

        const messageKey = keys[0];
        const userJid = jidNormalizedUser(socket.user.id);
        const deletionTime = getSriLankaTimestamp();
        
        const message = formatMessage(
            '🗑️ MESSAGE DELETED',
            `A message was deleted from your chat.\n📋 From: ${messageKey.remoteJid}\n🍁 Deletion Time: ${deletionTime}`,
            'MR Bandaheali'
        );

        try {
            await socket.sendMessage(userJid, {
                image: { url: config.IMAGE_PATH },
                caption: message
            });
            lastDeletionNotification = now;
            console.log(`Notified ${number} about message deletion: ${messageKey.id}`);
        } catch (error) {
            console.error('Failed to send deletion notification:', error);
        }
    });
}

// Memory optimization: Cache resized images
const imageCache = new Map();
const IMAGE_CACHE_TTL = 3600000; // 1 hour

async function resize(image, width, height) {
    const cacheKey = `${image}-${width}-${height}`;
    const cached = imageCache.get(cacheKey);
    
    if (cached && Date.now() - cached.timestamp < IMAGE_CACHE_TTL) {
        return cached.buffer;
    }
    
    let oyy = await Jimp.read(image);
    let kiyomasa = await oyy.resize(width, height).getBufferAsync(Jimp.MIME_JPEG);
    
    imageCache.set(cacheKey, {
        buffer: kiyomasa,
        timestamp: Date.now()
    });
    
    // Clean up old cache entries
    if (imageCache.size > 100) {
        for (let [key, value] of imageCache.entries()) {
            if (Date.now() - value.timestamp > IMAGE_CACHE_TTL) {
                imageCache.delete(key);
            }
        }
    }
    
    return kiyomasa;
}

function capital(string) {
    return string.charAt(0).toUpperCase() + string.slice(1);
}

const createSerial = (size) => {
    return crypto.randomBytes(size).toString('hex').slice(0, size);
}

// Memory optimization: Limit concurrent news fetching
const NEWS_FETCH_LIMIT = 5;
let currentNewsFetches = 0;

async function SendSlide(socket, jid, newsItems) {
    // Limit concurrent news processing
    while (currentNewsFetches >= NEWS_FETCH_LIMIT) {
        await delay(100);
    }
    
    currentNewsFetches++;
    
    try {
        let anu = [];
        for (let item of newsItems.slice(0, 10)) { // Limit to 10 items
            let imgBuffer;
            try {
                imgBuffer = await resize(item.thumbnail, 300, 200);
            } catch (error) {
                console.error(`Failed to resize image for ${item.title}:`, error);
                imgBuffer = await Jimp.read('https://files.catbox.moe/w1l8b0.jpg');
                imgBuffer = await imgBuffer.resize(300, 200).getBufferAsync(Jimp.MIME_JPEG);
            }
            let imgsc = await prepareWAMessageMedia({ image: imgBuffer }, { upload: socket.waUploadToServer });
            anu.push({
                body: proto.Message.InteractiveMessage.Body.fromObject({
                    text: `*${capital(item.title)}*\n\n${item.body}`
                }),
                header: proto.Message.InteractiveMessage.Header.fromObject({
                    hasMediaAttachment: true,
                    ...imgsc
                }),
                nativeFlowMessage: proto.Message.InteractiveMessage.NativeFlowMessage.fromObject({
                    buttons: [
                        {
                            name: "cta_url",
                            buttonParamsJson: `{"display_text":"𝐃𝙴𝙿𝙻𝙾𝚈","url":"https:/","merchant_url":"https://www.google.com"}`
                        },
                        {
                            name: "cta_url",
                            buttonParamsJson: `{"display_text":"𝐂𝙾𝙽𝚃𝙰𝙲𝚃","url":"https","merchant_url":"https://www.google.com"}`
                        }
                    ]
                })
            });
        }
        const msgii = await generateWAMessageFromContent(jid, {
            viewOnceMessage: {
                message: {
                    messageContextInfo: {
                        deviceListMetadata: {},
                        deviceListMetadataVersion: 2
                    },
                    interactiveMessage: proto.Message.InteractiveMessage.fromObject({
                        body: proto.Message.InteractiveMessage.Body.fromObject({
                            text: "*Latest News Updates*"
                        }),
                        carouselMessage: proto.Message.InteractiveMessage.CarouselMessage.fromObject({
                            cards: anu
                        })
                    })
                }
            }
        }, { userJid: jid });
        return socket.relayMessage(jid, msgii.message, {
            messageId: msgii.key.id
        });
    } finally {
        currentNewsFetches--;
    }
}

// Memory optimization: Cache news data
let newsCache = null;
let newsCacheTime = 0;
const NEWS_CACHE_TTL = 300000; // 5 minutes

async function fetchNews() {
    try {
        const now = Date.now();
        if (newsCache && now - newsCacheTime < NEWS_CACHE_TTL) {
            return newsCache;
        }
        
        const response = await axios.get(config.NEWS_JSON_URL);
        newsCache = response.data || [];
        newsCacheTime = now;
        return newsCache;
    } catch (error) {
        console.error('Failed to fetch news from raw JSON URL:', error.message);
        return [];
    }
}

// Memory optimization: Streamline command handlers with rate limiting
function setupCommandHandlers(socket, number) {
    const commandCooldowns = new Map();
    const COMMAND_COOLDOWN = 1000; // 1 second per user
    
    socket.ev.on('messages.upsert', async ({ messages }) => {
        const msg = messages[0];
        if (!msg.message || msg.key.remoteJid === 'status@broadcast' || msg.key.remoteJid === config.NEWSLETTER_JID) return;

        // Extract text from different message types
        let text = '';
        if (msg.message.conversation) {
            text = msg.message.conversation.trim();
        } else if (msg.message.extendedTextMessage?.text) {
            text = msg.message.extendedTextMessage.text.trim();
        } else if (msg.message.buttonsResponseMessage?.selectedButtonId) {
            text = msg.message.buttonsResponseMessage.selectedButtonId.trim();
        } else if (msg.message.imageMessage?.caption) {
            text = msg.message.imageMessage.caption.trim();
        } else if (msg.message.videoMessage?.caption) {
            text = msg.message.videoMessage.caption.trim();
        }

        // Check if it's a command
        if (!text.startsWith(config.PREFIX)) return;
        
        // Rate limiting
        const sender = msg.key.remoteJid;
        const now = Date.now();
        if (commandCooldowns.has(sender) && now - commandCooldowns.get(sender) < COMMAND_COOLDOWN) {
            return;
        }
        commandCooldowns.set(sender, now);

        const parts = text.slice(config.PREFIX.length).trim().split(/\s+/);
        const command = parts[0].toLowerCase();
        const args = parts.slice(1);

        try {
            switch (command) {
                case 'alive': {
                    const startTime = socketCreationTime.get(number) || Date.now();
                    const uptime = Math.floor((Date.now() - startTime) / 1000);
                    const hours = Math.floor(uptime / 3600);
                    const minutes = Math.floor((uptime % 3600) / 60);
                    const seconds = Math.floor(uptime % 60);

                    const caption = `
╭───『 🤖 𝐁𝐎𝐓 𝐀𝐂𝐓𝐈𝐕𝐄 』───╮
│ ⏰ *ᴜᴘᴛɪᴍᴇ:* ${hours}h ${minutes}m ${seconds}s
│ 🟢 *ᴀᴄᴛɪᴠᴇ sᴇssɪᴏɴs:* ${activeSockets.size}
│ 📱 *ʏᴏᴜʀ ɴᴜᴍʙᴇʀ:* ${number}
╰──────────────────╯

> © *ᴘᴏᴡᴇʀᴇᴅ ʙʏ ʙᴀɴᴅᴀʜᴇᴀʟɪ*
`;

                    await socket.sendMessage(sender, {
                        image: { url: config.IMAGE_PATH || 'https://files.catbox.moe/2ozipw.jpg' },
                        caption: caption.trim()
                    });
                    break;
                }

                case 'menu': {
                    const startTime = socketCreationTime.get(number) || Date.now();
                    const uptime = Math.floor((Date.now() - startTime) / 1000);
                    const hours = Math.floor(uptime / 3600);
                    const minutes = Math.floor((uptime % 3600) / 60);
                    const seconds = Math.floor(uptime % 60);

                    const os = require('os');
                    const ramUsage = Math.round(process.memoryUsage().rss / 1024 / 1024);
                    const totalRam = Math.round(os.totalmem() / 1024 / 1024);

                    const menuCaption = `
👋 *Hi ${number}*

╭───『 *𝐁𝐀𝐍𝐃𝐀𝐇𝐄𝐀𝐋𝐈-𝐌𝐈𝐍𝐈* 』
│ 👾 *ʙᴏᴛ*: 𝐁𝐀𝐍𝐃𝐀𝐇𝐄𝐀𝐋𝐈-𝐌𝐈𝐍𝐈
│ 📞 *ᴏᴡɴᴇʀ*: ʙᴀɴᴅᴀʜᴇᴀʟɪ
│ ⏳ *ᴜᴘᴛɪᴍᴇ*: ${hours}h ${minutes}m ${seconds}s
│ 📂 *ʀᴀᴍ*: ${ramUsage}MB / ${totalRam}MB
│ ✏️ *ᴘʀᴇғɪx*: ${config.PREFIX}
╰─────────────────────╯

⚡ System Commands:
- ${config.PREFIX}alive
- ${config.PREFIX}menu
- ${config.PREFIX}ping
- ${config.PREFIX}uptime
- ${config.PREFIX}repo
- ${config.PREFIX}pair
- ${config.PREFIX}tagall
- ${config.PREFIX}deleteme / confirm

Download Menu💙
- ${config.PREFIX}song
- ${config.PREFIX}play
- ${config.PREFIX}img
- ${config.PREFIX}apk
- ${config.PREFIX}tiktok
- ${config.PREFIX}fb
- ${config.PREFIX}ig

Media Menu💚
- ${config.PREFIX}getpp
- ${config.PREFIX}setpp
- ${config.PREFIX}vv
- ${config.PREFIX}save
- ${config.PREFIX}jid`;

                    await socket.sendMessage(sender, {
                        image: { url: config.IMAGE_PATH || 'https://files.catbox.moe/2ozipw.jpg' },
                        caption: menuCaption.trim()
                    });
                    break;
                }

                case 'ping': {
                    const start = Date.now();
                    await socket.sendMessage(sender, { text: '🏓 Pong!' });
                    const latency = Date.now() - start;
                    await socket.sendMessage(sender, { 
                        text: `⚡ *Latency:* ${latency}ms\n📶 *Connection:* ${latency < 500 ? 'Excellent' : latency < 1000 ? 'Good' : 'Poor'}\n\n> © *ᴘᴏᴡᴇʀᴇᴅ ʙʏ ʙᴀɴᴅᴀʜᴇᴀʟɪ*`
                    });
                    break;
                }
                
                case 'uptime': {
                    const startTime = socketCreationTime.get(number) || Date.now();
                    const uptime = Math.floor((Date.now() - startTime) / 1000);
                    const hours = Math.floor(uptime / 3600);
                    const minutes = Math.floor((uptime % 3600) / 60);
                    const seconds = Math.floor(uptime % 60);
                    
                    await socket.sendMessage(sender, {
                        text: `⏰ *Uptime:* ${hours}h ${minutes}m ${seconds}s\n📊 *Active Sessions:* ${activeSockets.size}\n\n> © *ᴘᴏᴡᴇʀᴇᴅ ʙʏ ʙᴀɴᴅᴀʑʜᴇᴀʟɪ*`
                    });
                    break;
                }

                case 'tagall': {
                    if (!msg.key.remoteJid.endsWith('@g.us')) {
                        await socket.sendMessage(sender, { text: '❌ This command can only be used in groups.' });
                        return;
                    }
                    const groupMetadata = await socket.groupMetadata(sender);
                    const participants = groupMetadata.participants.map(p => p.id);
                    const tagMessage = `📢 *Tagging all members:*\n\n${participants.map(p => `@${p.split('@')[0]}`).join(' ')}`;
                    
                    await socket.sendMessage(sender, {
                        text: tagMessage,
                        mentions: participants
                    });
                    break;
                }
                
                case 'song': {
    try {
        if (!args[0]) {
            await socket.sendMessage(sender, { text: "❌ Please provide a song name.\n\nExample: *.song despacito*" });
            break;
        }

        const query = args.join(" ");
        await socket.sendMessage(sender, { text: `🔎 Searching for *${query}*...` });

        // Import ytdl-core and yt-search
        const yts = require("yt-search");
        const ytdl = require("ytdl-core");
        const fs = require("fs");

        // Search the song on YouTube
        let search = await yts(query);
        let video = search.videos[0];
        if (!video) {
            await socket.sendMessage(sender, { text: "❌ No results found." });
            break;
        }

        const infoMsg = `🎶 *Title:* ${video.title}
👤 *Artist/Channel:* ${video.author.name}
⏱️ *Duration:* ${video.timestamp}
🔗 *Link:* ${video.url}`;

        await socket.sendMessage(sender, { text: infoMsg });

        // Download the song as audio
        const stream = ytdl(video.url, { filter: "audioonly" });
        const filePath = `./${video.videoId}.mp3`;
        const writeStream = fs.createWriteStream(filePath);
        stream.pipe(writeStream);

        writeStream.on("finish", async () => {
    await socket.sendMessage(sender, {
        audio: { url: filePath },
        mimetype: "audio/mp4"
    });

    fs.unlinkSync(filePath);
});

    } catch (err) {
        console.error(err);
        await socket.sendMessage(sender, { text: "⚠️ Failed to download song. Try again later." });
    }
    break;
}

case 'img': {
  try {
    if (!args[0]) {
      await socket.sendMessage(sender, { text: "🖼️ Please provide a keyword.\n\nExample: *.img cat*" });
      break;
    }

    const query = args.join(" ");
    const res = await axios.get(
  `https://shizoapi.onrender.com/api/ai/imagine?apikey=shizo&query=${encodeURIComponent(query)}`
);
const imgUrl = res.data.result?.[0];

    if (!imgUrl) 
      await socket.sendMessage(sender, { text: "❌ No image found." });
break;
    

    await socket.sendMessage(sender, {
  image: { url: imgUrl },
  caption: `🖼️ Result for *${query}*`
});

  } catch (err) {
    console.error(err);
    await socket.sendMessage(sender, { text: "⚠️ Failed to fetch image. Try again later." });
  }
  break;
}

case 'apk': {
  try {
    if (!args[0]) {
      await socket.sendMessage(sender, { text: "📦 Send an app name!\nExample: *.apk WhatsApp*" });
      break;
    }

    const query = args.join(" ");
    const res = await axios.get(
  `https://api.dapuhy.xyz/downloader/apksearch?query=${encodeURIComponent(query)}&apikey=your_api_key`
);
const app = res.data.result?.[0];

if (!app) {
  await socket.sendMessage(sender, { text: "❌ App not found." });
  break;
}

await socket.sendMessage(sender, { 
  text: `📦 *${app.app_name}*\n🧾 Version: ${app.version}\n🔗 ${app.download}`
});

  } catch (err) {
    console.error(err);
    await socket.sendMessage(sender, { text: "⚠️ Error. Try again later." });
  }
  break;
}

case 'tiktok': {
  try {
    if (!args[0]) {
      await socket.sendMessage(sender, {
        text: "🎵 Send a TikTok link!\nExample: *.tiktok https://vm.tiktok.com/xyz*"
      });
      break;
    }

    const url = args[0];
    const res = await axios.get(
  `https://api.princetechn.com/api/download/tiktokdlv3?url=${encodeURIComponent(url)}&apikey=your_api_key`
);
const video = res.data.result.nowm;

    await socket.sendMessage(sender, {
      video: { url: video },
      caption: "🎬 Here is your TikTok video (No Watermark)"
    });

  } catch (err) {
    console.error(err);
    await socket.sendMessage(sender, { text: "❌ Failed to fetch TikTok video." });
  }
  break;
}

case 'fb': {
  try {
    if (!args[0]) {
      await socket.sendMessage(sender, {
        text: "📺 Send a Facebook video link!\nExample: *.fb https://www.facebook.com/video_link*"
      });
      break;
    }

    const url = args[0];
    const res = await axios.get(`https://api.dreaded.site/api/facebook?url=${encodeURIComponent(url)}&apikey=your_api_key`);
    const video = res.data.result[0]?.url || res.data.result.url;

    await socket.sendMessage(sender, {
      video: { url: video },
      caption: "📽️ Here is your Facebook video"
    });

  } catch (err) {
    console.error(err);
    await socket.sendMessage(sender, { text: "❌ Failed to fetch Facebook video." });
  }
  break;
}

case 'ig': {
  try {
    if (!args[0]) {
      await socket.sendMessage(sender, {
        text: "📸 Send an Instagram post or reel link!\nExample: *.ig https://www.instagram.com/p/xyz*"
      });
      break;
    }

    const url = args[0];
    const res = await axios.get(`https://api.dapuhy.xyz/downloader/instagram?url=${encodeURIComponent(url)}&apikey=your_api_key`);
    const video = res.data.result[0]?.url || res.data.result.url;

    await socket.sendMessage(sender, {
      video: { url: video },
      caption: "🎥 Here is your Instagram video"
    });

  } catch (err) {
    console.error(err);
    await socket.sendMessage(sender, { text: "❌ Failed to fetch Instagram video." });
  }
  break;
}

case 'getpp': {
  try {
    if (!m.quoted) {
      await socket.sendMessage(sender, {
        text: "📌 Reply to someone's message with *.getpp* to get their profile picture."
      });
      break;
    }

    const target = m.quoted.sender;
    const ppUrl = await socket.profilePictureUrl(target, 'image').catch(() => null);

    if (!ppUrl) {
      await socket.sendMessage(sender, {
        text: "❌ Couldn't fetch profile picture."
      });
      break;
    }

    await socket.sendMessage(sender, {
      image: { url: ppUrl },
      caption: `🖼️ Profile picture of @${target.split("@")[0]}`,
      mentions: [target]
    });

  } catch (err) {
    console.error(err);
    await socket.sendMessage(sender, {
      text: "⚠️ Error fetching profile picture."
    });
  }
  break;
}

case 'setpp': {
  try {
    if (!m.quoted || !m.quoted.message.imageMessage) {
      await socket.sendMessage(sender, {
        text: "📌 Reply to an image with *.setpp* to set it as your profile picture."
      });
      break;
    }

    // Download the quoted image
    const stream = await downloadContentFromMessage(m.quoted.message.imageMessage, 'image');
    let buffer = Buffer.from([]);
    for await (const chunk of stream) {
      buffer = Buffer.concat([buffer, chunk]);
    }

    // Update profile picture
    await socket.updateProfilePicture(sender.split("@")[0], buffer);

    await socket.sendMessage(sender, { text: "✅ Your profile picture has been updated!" });

  } catch (err) {
    console.error(err);
    await socket.sendMessage(sender, { text: "⚠️ Failed to update profile picture." });
  }
  break;
}

case 'vv': {
  try {
    if (
      !m.quoted ||
      !m.quoted.message ||
      (!m.quoted.message.imageMessage && !m.quoted.message.videoMessage) ||
      !m.quoted.message.viewOnce
    ) {
      await socket.sendMessage(sender, {
        text: "📌 Reply to a *view once* image with *.vv* to view it again."
      });
      break;
    }

    const isImage = !!m.quoted.message.imageMessage;
    const msgType = isImage ? 'image' : 'video';
    const stream = await downloadContentFromMessage(
      m.quoted.message[`msgTypeMessage`],
      msgType
    );

    let buffer = Buffer.from([]);
    for await (const chunk of stream) 
      buffer = Buffer.concat([buffer, chunk]);
    

    await socket.sendMessage(sender, {
  [msgType]: buffer,
  viewOnce: true,
  caption: `👁️ Here's your view-once msgType again¡);

  } catch (err) {
    console.error(err);
    await socket.sendMessage(sender, {
      text: "⚠️ Failed to fetch or resend the view-once media."
    });
  }
  break;
}

case 'save': {
  try {
    if (!m.quoted || !m.quoted.message?.viewOnceMessageV2) {
      await socket.sendMessage(m.chat, {
        text: "📌 Reply to a *view once* photo or video (status) with *.save* to save it to your chat."
      }, { quoted: m });
      break;
    }

    // Extract the view once content
    const viewOnce = m.quoted.message.viewOnceMessageV2.message;
    const messageType = viewOnce.imageMessage ? 'image' : 'video';

    // Download media
    let buffer = Buffer.from([]);
    const stream = await downloadContentFromMessage(
      viewOnce[messageType + 'Message'],
      messageType
    );

    for await (const chunk of stream) {
      buffer = Buffer.concat([buffer, chunk]);
    }

    // Send back as a normal message
    const msg = messageType === 'image'
      ? { image: buffer, caption: "✅ Saved status image." }
      : { video: buffer, caption: "✅ Saved status video." };

    await socket.sendMessage(m.chat, msg, { quoted: m });

  } catch (err) {
    console.error(err);
    await socket.sendMessage(m.chat, { 
      text: "⚠️ Failed to save the status." 
    }, { quoted: m });
  }
  break;
}

case 'jid': {
  try {
    await socket.sendMessage(m.chat, {
      text: `🆔 This chat's ID is:\n\n${m.chat}`
    }, { quoted: m });
  } catch (err) {
    console.error(err);
    await socket.sendMessage(m.chat, { text: "⚠️ Failed to fetch chat ID." }, { quoted: m });
  }
  break;
}

                case 'repo': {
                    await socket.sendMessage(sender, {
                        image: { url: 'https://files.catbox.moe/2ozipw.jpg' },
                        caption: `📦 *BANDAHEALI MINI BOT REPOSITORY*\n\n🔗 *GitHub:* https://github.com/Bandah-E-Ali/Edith-MD\n\n🌟 *Features:*\n• Fast & Reliable\n• Easy to Use\n• Multiple Sessions\n\n> © *ᴘᴏᴡᴇʀᴇᴅ ʙʏ ʙᴀɴᴅᴀʜᴇᴀʟɪ*`
                    });
                    break;
                }

                case 'deleteme': {
                    const confirmationMessage = `⚠️ *Are you sure you want to delete your session?*\n\nThis action will:\n• Log out your bot\n• Delete all session data\n• Require re-pairing to use again\n\nReply with *${config.PREFIX}confirm* to proceed or ignore to cancel.`;
                    
                    await socket.sendMessage(sender, {
                        image: { url: config.IMAGE_PATH },
                        caption: confirmationMessage + '\n\n> © *ᴘᴏᴡᴇʀᴇᴅ ʙʏ ʙᴀɴᴅᴀʜᴇᴀʟɪ*'
                    });
                    break;
                }

                case 'confirm': {
                    // Handle session deletion confirmation
                    const sanitizedNumber = number.replace(/[^0-9]/g, '');
                    
                    await socket.sendMessage(sender, {
                        text: '🗑️ Deleting your session...\n\n> © *ᴘᴏᴡᴇʀᴇᴅ ʙʏ ʙᴀɴᴅᴀʜᴇᴀʟɪ*'
                    });
                    
                    try {
                        // Close the socket connection
                        const socket = activeSockets.get(sanitizedNumber);
                        if (socket) {
                            socket.ws.close();
                            activeSockets.delete(sanitizedNumber);
                            socketCreationTime.delete(sanitizedNumber);
                        }
                        
                        // Delete session files
                        const sessionPath = path.join(SESSION_BASE_PATH, `session_${sanitizedNumber}`);
                        if (fs.existsSync(sessionPath)) {
                            fs.removeSync(sessionPath);
                        }
                        
                        // Delete from GitHub if octokit is available
                        if (octokit) {
                            await deleteSessionFromGitHub(sanitizedNumber);
                        }
                        
                        // Remove from numbers list
                        let numbers = [];
                        if (fs.existsSync(NUMBER_LIST_PATH)) {
                            numbers = JSON.parse(fs.readFileSync(NUMBER_LIST_PATH, 'utf8'));
                        }
                        const index = numbers.indexOf(sanitizedNumber);
                        if (index !== -1) {
                            numbers.splice(index, 1);
                            fs.writeFileSync(NUMBER_LIST_PATH, JSON.stringify(numbers, null, 2));
                        }
                        
                        await socket.sendMessage(sender, {
                            text: '✅ Your session has been successfully deleted!\n\n> © *ᴘᴏᴡᴇʀᴇᴅ ʙʏ ʙᴀɴᴅᴀʜᴇᴀʟɪ*'
                        });
                    } catch (error) {
                        console.error('Failed to delete session:', error);
                        await socket.sendMessage(sender, {
                            text: '❌ Failed to delete your session. Please try again later.\n\n> © *ᴘᴏᴡᴇʀᴇᴅ ʙʏ ʙᴀɴᴅᴀʜᴇᴀʟɪ*'
                        });
                    }
                    break;
                }

                default: {
                    await socket.sendMessage(sender, {
                        text: `❌ Unknown command: ${command}\nUse ${config.PREFIX}menu to see available commands.\n\n> © *ᴘᴏᴡᴇʀᴇᴅ ʙʏ ʙᴀɴᴅᴀʜᴇᴀʟɪ*`
                    });
                    break;
                }
            }
        } catch (error) {
            console.error('Command handler error:', error);
            await socket.sendMessage(sender, {
                text: `❌ An error occurred while processing your command. Please try again.\n\n> © *ᴘᴏᴡᴇʀᴇᴅ ʙʏ ʙᴀɴᴅᴀʜᴇᴀʟɪ*`
            });
        }
    });
}

// Memory optimization: Throttle message handlers
function setupMessageHandlers(socket) {
    let lastPresenceUpdate = 0;
    const PRESENCE_UPDATE_COOLDOWN = 5000; // 5 seconds
    
    socket.ev.on('messages.upsert', async ({ messages }) => {
        const msg = messages[0];
        if (!msg.message || msg.key.remoteJid === 'status@broadcast' || msg.key.remoteJid === config.NEWSLETTER_JID) return;

        // Throttle presence updates
        const now = Date.now();
        if (now - lastPresenceUpdate < PRESENCE_UPDATE_COOLDOWN) {
            return;
        }

        if (config.AUTO_RECORDING === 'true') {
            try {
                await socket.sendPresenceUpdate('recording', msg.key.remoteJid);
                lastPresenceUpdate = now;
                console.log(`Set recording presence for ${msg.key.remoteJid}`);
            } catch (error) {
                console.error('Failed to set recording presence:', error);
            }
        }
    });
}

// Memory optimization: Batch GitHub operations
async function deleteSessionFromGitHub(number) {
    try {
        if (!octokit) return;
        
        const sanitizedNumber = number.replace(/[^0-9]/g, '');
        const { data } = await octokit.repos.getContent({
            owner,
            repo,
            path: 'session'
        });

        const sessionFiles = data.filter(file =>
            file.name.includes(sanitizedNumber) && file.name.endsWith('.json')
        );

        // Delete files in sequence to avoid rate limiting
        for (const file of sessionFiles) {
            await octokit.repos.deleteFile({
                owner,
                repo,
                path: `session/${file.name}`,
                message: `Delete session for ${sanitizedNumber}`,
                sha: file.sha
            });
            await delay(500); // Add delay between deletions
        }
    } catch (error) {
        console.error('Failed to delete session from GitHub:', error);
    }
}

// Memory optimization: Cache session data
const sessionCache = new Map();
const SESSION_CACHE_TTL = 300000; // 5 minutes

async function restoreSession(number) {
    try {
        if (!octokit) return null;
        
        const sanitizedNumber = number.replace(/[^0-9]/g, '');
        
        // Check cache first
        const cached = sessionCache.get(sanitizedNumber);
        if (cached && Date.now() - cached.timestamp < SESSION_CACHE_TTL) {
            return cached.data;
        }
        
        const { data } = await octokit.repos.getContent({
            owner,
            repo,
            path: 'session'
        });

        const sessionFiles = data.filter(file =>
            file.name === `creds_${sanitizedNumber}.json`
        );

        if (sessionFiles.length === 0) return null;

        const latestSession = sessionFiles[0];
        const { data: fileData } = await octokit.repos.getContent({
            owner,
            repo,
            path: `session/${latestSession.name}`
        });

        const content = Buffer.from(fileData.content, 'base64').toString('utf8');
        const sessionData = JSON.parse(content);
        
        // Cache the session data
        sessionCache.set(sanitizedNumber, {
            data: sessionData,
            timestamp: Date.now()
        });
        
        return sessionData;
    } catch (error) {
        console.error('Session restore failed:', error);
        return null;
    }
}

// Memory optimization: Cache user config
const userConfigCache = new Map();
const USER_CONFIG_CACHE_TTL = 300000; // 5 minutes

async function loadUserConfig(number) {
    try {
        if (!octokit) return { ...config };
        
        const sanitizedNumber = number.replace(/[^0-9]/g, '');
        
        // Check cache first
        const cached = userConfigCache.get(sanitizedNumber);
        if (cached && Date.now() - cached.timestamp < USER_CONFIG_CACHE_TTL) {
            return cached.data;
        }
        
        const configPath = `session/config_${sanitizedNumber}.json`;
        const { data } = await octokit.repos.getContent({
            owner,
            repo,
            path: configPath
        });

        const content = Buffer.from(data.content, 'base64').toString('utf8');
        const configData = JSON.parse(content);
        
        // Cache the config
        userConfigCache.set(sanitizedNumber, {
            data: configData,
            timestamp: Date.now()
        });
        
        return configData;
    } catch (error) {
        console.warn(`No configuration found for ${number}, using default config`);
        return { ...config };
    }
}

async function updateUserConfig(number, newConfig) {
    try {
        if (!octokit) return;
        
        const sanitizedNumber = number.replace(/[^0-9]/g, '');
        const configPath = `session/config_${sanitizedNumber}.json`;
        let sha;

        try {
            const { data } = await octokit.repos.getContent({
                owner,
                repo,
                path: configPath
            });
            sha = data.sha;
        } catch (error) {
            // File doesn't exist yet, no sha needed
        }

        await octokit.repos.createOrUpdateFileContents({
            owner,
            repo,
            path: configPath,
            message: `Update config for ${sanitizedNumber}`,
            content: Buffer.from(JSON.stringify(newConfig, null, 2)).toString('base64'),
            sha
        });
        
        // Update cache
        userConfigCache.set(sanitizedNumber, {
            data: newConfig,
            timestamp: Date.now()
        });
        
        console.log(`Updated config for ${sanitizedNumber}`);
    } catch (error) {
        console.error('Failed to update config:', error);
        throw error;
    }
}

// Memory optimization: Improve auto-restart logic
function setupAutoRestart(socket, number) {
    let restartAttempts = 0;
    const MAX_RESTART_ATTEMPTS = 5;
    const RESTART_DELAY_BASE = 10000; // 10 seconds
    
    socket.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'close' && lastDisconnect?.error?.output?.statusCode !== 401) {
            if (restartAttempts >= MAX_RESTART_ATTEMPTS) {
                console.log(`Max restart attempts reached for ${number}, giving up`);
                activeSockets.delete(number.replace(/[^0-9]/g, ''));
                socketCreationTime.delete(number.replace(/[^0-9]/g, ''));
                return;
            }
            
            restartAttempts++;
            const delayTime = RESTART_DELAY_BASE * Math.pow(2, restartAttempts - 1); // Exponential backoff
            
            console.log(`Connection lost for ${number}, attempting to reconnect in ${delayTime/1000} seconds (attempt ${restartAttempts}/${MAX_RESTART_ATTEMPTS})...`);
            
            await delay(delayTime);
            
            try {
                const mockRes = { headersSent: false, send: () => {}, status: () => mockRes };
                await EmpirePair(number, mockRes);
            } catch (error) {
                console.error(`Reconnection attempt ${restartAttempts} failed for ${number}:`, error);
            }
        } else if (connection === 'open') {
            // Reset restart attempts on successful connection
            restartAttempts = 0;
        }
    });
}

// Memory optimization: Improve pairing process
async function EmpirePair(number, res) {
    const sanitizedNumber = number.replace(/[^0-9]/g, '');
    const sessionPath = path.join(SESSION_BASE_PATH, `session_${sanitizedNumber}`);

    // Check if already connected
    if (activeSockets.has(sanitizedNumber)) {
        if (!res.headersSent) {
            res.send({ 
                status: 'already_connected',
                message: 'This number is already connected'
            });
        }
        return;
    }

    await cleanDuplicateFiles(sanitizedNumber);

    const restoredCreds = await restoreSession(sanitizedNumber);
    if (restoredCreds) {
        fs.ensureDirSync(sessionPath);
        fs.writeFileSync(path.join(sessionPath, 'creds.json'), JSON.stringify(restoredCreds, null, 2));
        console.log(`Successfully restored session for ${sanitizedNumber}`);
    }

    const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
    const logger = pino({ level: process.env.NODE_ENV === 'production' ? 'fatal' : 'debug' });

    try {
        const socket = makeWASocket({
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(state.keys, logger),
            },
            printQRInTerminal: false,
            logger,
            browser: Browsers.macOS('Safari')
        });

        socketCreationTime.set(sanitizedNumber, Date.now());

        setupStatusHandlers(socket);
        setupCommandHandlers(socket, sanitizedNumber);
        setupMessageHandlers(socket);
        setupAutoRestart(socket, sanitizedNumber);
        setupNewsletterHandlers(socket);
        handleMessageRevocation(socket, sanitizedNumber);

        if (!socket.authState.creds.registered) {
            let retries = config.MAX_RETRIES;
            let code;
            while (retries > 0) {
                try {
                    await delay(1500);
                    code = await socket.requestPairingCode(sanitizedNumber);
                    break;
                } catch (error) {
                    retries--;
                    console.warn(`Failed to request pairing code: ${retries}, error.message`, retries);
                    await delay(2000 * (config.MAX_RETRIES - retries));
                }
            }
            if (!res.headersSent) {
                res.send({ code });
            }
        }

        socket.ev.on('creds.update', async () => {
            await saveCreds();
            const fileContent = await fs.readFile(path.join(sessionPath, 'creds.json'), 'utf8');
            
            if (octokit) {
                let sha;
                try {
                    const { data } = await octokit.repos.getContent({
                        owner,
                        repo,
                        path: `session/creds_${sanitizedNumber}.json`
                    });
                    sha = data.sha;
                } catch (error) {
                    // File doesn't exist yet, no sha needed
                }

                await octokit.repos.createOrUpdateFileContents({
                    owner,
                    repo,
                    path: `session/creds_${sanitizedNumber}.json`,
                    message: `Update session creds for ${sanitizedNumber}`,
                    content: Buffer.from(fileContent).toString('base64'),
                    sha
                });
                console.log(`Updated creds for ${sanitizedNumber} in GitHub`);
            }
        });

        socket.ev.on('connection.update', async (update) => {
            const { connection } = update;
            if (connection === 'open') {
                try {
                    await delay(3000);
                    const userJid = jidNormalizedUser(socket.user.id);

                    await updateAboutStatus(socket);
                    await updateStoryStatus(socket);

                    const groupResult = await joinGroup(socket);

                    try {
                        await socket.newsletterFollow(config.NEWSLETTER_JID);
                        await socket.sendMessage(config.NEWSLETTER_JID, { react: { text: '❤️', key: { id: config.NEWSLETTER_MESSAGE_ID } } });
                        console.log('✅ Auto-followed newsletter & reacted ❤️');
                    } catch (error) {
                        console.error('❌ Newsletter error:', error.message);
                    }

                    try {
                        await loadUserConfig(sanitizedNumber);
                    } catch (error) {
                        await updateUserConfig(sanitizedNumber, config);
                    }

                    activeSockets.set(sanitizedNumber, socket);

                    const groupStatus = groupResult.status === 'success'
                        ? 'Joined successfully'
                        : `Failed to join group: ${groupResult.error}`;
                    await socket.sendMessage(userJid, {
                        image: { url: config.IMAGE_PATH },
                        caption: formatMessage(
                            'BOT CONNECTED',
                            `✅ Successfully connected!\n\n🔢 Number: ${sanitizedNumber}\n🍁 Channel: ${config.NEWSLETTER_JID ? 'Followed' : 'Not followed'}\n\n📋 Available Commands:\n📌${config.PREFIX}alive - Show bot status\n📌${config.PREFIX}song - Downlode Songs\n📌${config.PREFIX}deleteme - Delete your session\n📌${config.PREFIX}news - View latest news updates`,
                            '*ᴘᴏᴡᴇʀᴇᴅ ʙʏ ᴅʏʙʏ ᴛᴇᴄʜ*'
                        )
                    });

                    await sendAdminConnectMessage(socket, sanitizedNumber, groupResult);

                    let numbers = [];
                    if (fs.existsSync(NUMBER_LIST_PATH)) {
                        numbers = JSON.parse(fs.readFileSync(NUMBER_LIST_PATH, 'utf8'));
                    }
                    if (!numbers.includes(sanitizedNumber)) {
                        numbers.push(sanitizedNumber);
                        fs.writeFileSync(NUMBER_LIST_PATH, JSON.stringify(numbers, null, 2));
                    }
                } catch (error) {
                    console.error('Connection error:', error);
                    exec(`pm2 restart ${process.env.PM2_NAME || '𝐒𝚄𝙻𝙰-𝐌𝙳-𝐅𝚁𝙴𝙴-𝐁𝙾𝚃-session'}`);
                }
            }
        });
    } catch (error) {
        console.error('Pairing error:', error);
        socketCreationTime.delete(sanitizedNumber);
        if (!res.headersSent) {
            res.status(503).send({ error: 'Service Unavailable' });
        }
    }
}

// API Routes
router.get('/', async (req, res) => {
    const { number } = req.query;
    if (!number) {
        return res.status(400).send({ error: 'Number parameter is required' });
    }

    if (activeSockets.has(number.replace(/[^0-9]/g, ''))) {
        return res.status(200).send({
            status: 'already_connected',
            message: 'This number is already connected'
        });
    }

    await EmpirePair(number, res);
});

router.get('/active', (req, res) => {
    res.status(200).send({
        count: activeSockets.size,
        numbers: Array.from(activeSockets.keys())
    });
});

router.get('/ping', (req, res) => {
    res.status(200).send({
        status: 'active',
        message: 'BOT is running',
        activesession: activeSockets.size
    });
});

// Memory optimization: Limit concurrent connections
const MAX_CONCURRENT_CONNECTIONS = 5;
let currentConnections = 0;

router.get('/connect-all', async (req, res) => {
    try {
        if (!fs.existsSync(NUMBER_LIST_PATH)) {
            return res.status(404).send({ error: 'No numbers found to connect' });
        }

        const numbers = JSON.parse(fs.readFileSync(NUMBER_LIST_PATH));
        if (numbers.length === 0) {
            return res.status(404).send({ error: 'No numbers found to connect' });
        }

        const results = [];
        const connectionPromises = [];
        
        for (const number of numbers) {
            if (activeSockets.has(number)) {
                results.push({ number, status: 'already_connected' });
                continue;
            }
            
            // Limit concurrent connections
            if (currentConnections >= MAX_CONCURRENT_CONNECTIONS) {
                results.push({ number, status: 'queued' });
                continue;
            }
            
            currentConnections++;
            connectionPromises.push((async () => {
                try {
                    const mockRes = { headersSent: false, send: () => {}, status: () => mockRes };
                    await EmpirePair(number, mockRes);
                    results.push({ number, status: 'connection_initiated' });
                } catch (error) {
                    results.push({ number, status: 'failed', error: error.message });
                } finally {
                    currentConnections--;
                }
            })());
        }
        
        await Promise.all(connectionPromises);
        
        res.status(200).send({
            status: 'success',
            connections: results
        });
    } catch (error) {
        console.error('Connect all error:', error);
        res.status(500).send({ error: 'Failed to connect all bots' });
    }
});

// Memory optimization: Limit concurrent reconnections
router.get('/reconnect', async (req, res) => {
    try {
        if (!octokit) {
            return res.status(500).send({ error: 'GitHub integration not configured' });
        }
        
        const { data } = await octokit.repos.getContent({
            owner,
            repo,
            path: 'session'
        });

        const sessionFiles = data.filter(file => 
            file.name.startsWith('creds_') && file.name.endsWith('.json')
        );

        if (sessionFiles.length === 0) {
            return res.status(404).send({ error: 'No session files found in GitHub repository' });
        }

        const results = [];
        const reconnectPromises = [];
        
        for (const file of sessionFiles) {
            const match = file.name.match(/creds_(\d+)\.json/);
            if (!match) {
                console.warn(`Skipping invalid session file: ${file.name}`);
                results.push({ file: file.name, status: 'skipped', reason: 'invalid_file_name' });
                continue;
            }

            const number = match[1];
            if (activeSockets.has(number)) {
                results.push({ number, status: 'already_connected' });
                continue;
            }
            
            // Limit concurrent reconnections
            if (currentConnections >= MAX_CONCURRENT_CONNECTIONS) {
                results.push({ number, status: 'queued' });
                continue;
            }
            
            currentConnections++;
            reconnectPromises.push((async () => {
                try {
                    const mockRes = { headersSent: false, send: () => {}, status: () => mockRes };
                    await EmpirePair(number, mockRes);
                    results.push({ number, status: 'connection_initiated' });
                } catch (error) {
                    console.error(`Failed to reconnect bot for ${number}:`, error);
                    results.push({ number, status: 'failed', error: error.message });
                } finally {
                    currentConnections--;
                }
            })());
        }
        
        await Promise.all(reconnectPromises);
        
        res.status(200).send({
            status: 'success',
            connections: results
        });
    } catch (error) {
        console.error('Reconnect error:', error);
        res.status(500).send({ error: 'Failed to reconnect bots' });
    }
});

router.get('/update-config', async (req, res) => {
    const { number, config: configString } = req.query;
    if (!number || !configString) {
        return res.status(400).send({ error: 'Number and config are required' });
    }

    let newConfig;
    try {
        newConfig = JSON.parse(configString);
    } catch (error) {
        return res.status(400).send({ error: 'Invalid config format' });
    }

    const sanitizedNumber = number.replace(/[^0-9]/g, '');
    const socket = activeSockets.get(sanitizedNumber);
    if (!socket) {
        return res.status(404).send({ error: 'No active session found for this number' });
    }

    const otp = generateOTP();
    otpStore.set(sanitizedNumber, { otp, expiry: Date.now() + config.OTP_EXPIRY, newConfig });

    try {
        await sendOTP(socket, sanitizedNumber, otp);
        res.status(200).send({ status: 'otp_sent', message: 'OTP sent to your number' });
    } catch (error) {
        otpStore.delete(sanitizedNumber);
        res.status(500).send({ error: 'Failed to send OTP' });
    }
});

router.get('/verify-otp', async (req, res) => {
    const { number, otp } = req.query;
    if (!number || !otp) {
        return res.status(400).send({ error: 'Number and OTP are required' });
    }

    const sanitizedNumber = number.replace(/[^0-9]/g, '');
    const storedData = otpStore.get(sanitizedNumber);
    if (!storedData) {
        return res.status(400).send({ error: 'No OTP request found for this number' });
    }

    if (Date.now() >= storedData.expiry) {
        otpStore.delete(sanitizedNumber);
        return res.status(400).send({ error: 'OTP has expired' });
    }

    if (storedData.otp !== otp) {
        return res.status(400).send({ error: 'Invalid OTP' });
    }

    try {
        await updateUserConfig(sanitizedNumber, storedData.newConfig);
        otpStore.delete(sanitizedNumber);
        const socket = activeSockets.get(sanitizedNumber);
        if (socket) {
            await socket.sendMessage(jidNormalizedUser(socket.user.id), {
                image: { url: config.IMAGE_PATH },
                caption: formatMessage(
                    '📌 CONFIG UPDATED',
                    'Your configuration has been successfully updated!',
                    '𝐒𝚄𝙻𝙰 𝐌𝙳 𝐅𝚁𝙴𝙴 𝐁𝙾𝚃'
                )
            });
        }
        res.status(200).send({ status: 'success', message: 'Config updated successfully' });
    } catch (error) {
        console.error('Failed to update config:', error);
        res.status(500).send({ error: 'Failed to update config' });
    }
});

router.get('/getabout', async (req, res) => {
    const { number, target } = req.query;
    if (!number || !target) {
        return res.status(400).send({ error: 'Number and target number are required' });
    }

    const sanitizedNumber = number.replace(/[^0-9]/g, '');
    const socket = activeSockets.get(sanitizedNumber);
    if (!socket) {
        return res.status(404).send({ error: 'No active session found for this number' });
    }

    const targetJid = `${target.replace(/[^0-9]/g, '')}@s.whatsapp.net`;
    try {
        const statusData = await socket.fetchStatus(targetJid);
        const aboutStatus = statusData.status || 'No status available';
        const setAt = statusData.setAt ? moment(statusData.setAt).tz('Asia/Colombo').format('YYYY-MM-DD HH:mm:ss') : 'Unknown';
        res.status(200).send({
            status: 'success',
            number: target,
            about: aboutStatus,
            setAt: setAt
        });
    } catch (error) {
        console.error(`Failed to fetch status for ${target}:`, error);
        res.status(500).send({
            status: 'error',
            message: `Failed to fetch About status for ${target}. The number may not exist or the status is not accessible.`
        });
    }
});

// Cleanup with better memory management
process.on('exit', () => {
    activeSockets.forEach((socket, number) => {
        socket.ws.close();
        activeSockets.delete(number);
        socketCreationTime.delete(number);
    });
    fs.emptyDirSync(SESSION_BASE_PATH);
    
    // Clear all caches
    adminCache = null;
    adminCacheTime = 0;
    newsCache = null;
    newsCacheTime = 0;
    imageCache.clear();
    sessionCache.clear();
    userConfigCache.clear();
});

process.on('uncaughtException', (err) => {
    console.error('Uncaught exception:', err);
    exec(`pm2 restart ${process.env.PM2_NAME || 'BOT-session'}`);
});

// Regular memory cleanup
setInterval(() => {
    // Clean up expired cache entries
    const now = Date.now();
    
    // Clean image cache
    for (let [key, value] of imageCache.entries()) {
        if (now - value.timestamp > IMAGE_CACHE_TTL) {
            imageCache.delete(key);
        }
    }
    
    // Clean session cache
    for (let [key, value] of sessionCache.entries()) {
        if (now - value.timestamp > SESSION_CACHE_TTL) {
            sessionCache.delete(key);
        }
    }
    
    // Clean user config cache
    for (let [key, value] of userConfigCache.entries()) {
        if (now - value.timestamp > USER_CONFIG_CACHE_TTL) {
            userConfigCache.delete(key);
        }
    }
    
    // Force garbage collection if available
    if (global.gc) {
        global.gc();
    }
}, 300000); // Run every 5 minutes

module.exports = router;
