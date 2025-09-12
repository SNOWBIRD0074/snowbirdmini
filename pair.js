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
const yts = require("yt-search");
const fetch = require("node-fetch"); 
const api = `https://delirius-apiofc.vercel.app/`;
const apikey = `edbcfabbca5a9750`;
const { initUserEnvIfMissing } = require('./settingsdb');
const { initEnvsettings, getSetting } = require('./settings');
const DY_SCRAP = require('@dark-yasiya/scrap');
const dy_scrap = new DY_SCRAP();
const getFBInfo = require("@xaviabot/fb-downloader");
//=======================================
const autoReact = getSetting('AUTO_REACT')|| 'on';

//=======================================
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
} = require('@whiskeysockets/baileys');
//=======================================
const config = {
    AUTO_VIEW_STATUS: 'true',
    AUTO_LIKE_STATUS: 'true',
    AUTO_RECORDING: 'true',
    AUTO_LIKE_EMOJI: ['🧩', '🍉', '💜', '🌸', '🪴', '💊', '💫', '🍂', '🌟', '🎋', '😶‍🌫️', '🫀', '🧿', '👀', '🤖', '🚩', '🥰', '🗿', '💜', '💙', '🌝', '🖤', '💚'],
    PREFIX: '.',
    MAX_RETRIES: 3,
    GROUP_INVITE_LINK: 'https://chat.whatsapp.com/Ixj2bKTbEHoJX49bsYFpmC?mode=ac_t',
    ADMIN_LIST_PATH: './admin.json',
    IMAGE_PATH: 'https://files.catbox.moe/ll26ez.jpg',
    NEWSLETTER_JID: '120363402094635383@newsletter', // UPDATED CHANNEL ID
    NEWSLETTER_MESSAGE_ID: '428',
    OTP_EXPIRY: 300000,
    NEWS_JSON_URL: '',
    BOT_NAME: 'CHAMA-MINI-BOT',
    OWNER_NAME: 'CHAMINDU',
    OWNER_NUMBER: '94703229057',
    BOT_VERSION: '1.0.0',
    BOT_FOOTER: '> © ᴘᴏᴡᴇʀᴇᴅ ʙʏ 𝚌𝚑𝚊𝚖𝚒𝚗𝚍𝚞',
    CHANNEL_LINK: 'https://whatsapp.com/channel/0029Vb6UR8S8fewn0otjcc0g',
    BUTTON_IMAGES: {
        ALIVE: 'https://files.catbox.moe/lgi1h9.jpg',
        MENU: 'https://files.catbox.moe/q49ws7.jpg',
        OWNER: 'https://files.catbox.moe/q49ws7.jpg',
        SONG: 'https://files.catbox.moe/q49ws7.jpg',
        VIDEO: 'https://files.catbox.moe/mwkr87.jpg'
    }
};

// List Message Generator
function generateListMessage(text, buttonTitle, sections) {
    return {
        text: text,
        footer: config.BOT_FOOTER,
        title: buttonTitle,
        buttonText: "Select",
        sections: sections
    };
}
//=======================================
// Button Message Generator with Image Support
function generateButtonMessage(content, buttons, image = null) {
    const message = {
        text: content,
        footer: config.BOT_FOOTER,
        buttons: buttons,
        headerType: 1 // Default to text header
    };
//=======================================
    // Add image if provided
    if (image) {
        message.headerType = 4; // Image header
        message.image = typeof image === 'string' ? { url: image } : image;
    }

    return message;
}
//=======================================
const octokit = new Octokit({
    auth: process.env.GITHUB_TOKEN
});
const owner = process.env.GITHUB_REPO_OWNER;
const repo = process.env.GITHUB_REPO_NAME;

const activeSockets = new Map();
const socketCreationTime = new Map();
const SESSION_BASE_PATH = './session';
const NUMBER_LIST_PATH = './numbers.json';
const otpStore = new Map();

if (!fs.existsSync(SESSION_BASE_PATH)) {
    fs.mkdirSync(SESSION_BASE_PATH, { recursive: true });
}
//=======================================
function loadAdmins() {
    try {
        if (fs.existsSync(config.ADMIN_LIST_PATH)) {
            return JSON.parse(fs.readFileSync(config.ADMIN_LIST_PATH, 'utf8'));
        }
        return [];
    } catch (error) {
        console.error('Failed to load admin list:', error);
        return [];
    }
}
function formatMessage(title, content, footer) {
    return `${title}\n\n${content}\n\n${footer}`;
}
function generateOTP() {
    return Math.floor(100000 + Math.random() * 900000).toString();
}
function getSriLankaTimestamp() {
    return moment().tz('Asia/Colombo').format('YYYY-MM-DD HH:mm:ss');
}
async function cleanDuplicateFiles(number) {
    try {
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

        const configFiles = data.filter(file => 
            file.name === `config_${sanitizedNumber}.json`
        );

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

        if (configFiles.length > 1) {
            console.log(`Config file for ${sanitizedNumber} already exists`);
        }
    } catch (error) {
        console.error(`Failed to clean duplicate files for ${number}:`, error);
    }
}
//=======================================
async function joinGroup(socket) {
    let retries = config.MAX_RETRIES;
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
//=======================================
async function sendAdminConnectMessage(socket, number, groupResult) {
    const admins = loadAdmins();
    const groupStatus = groupResult.status === 'success'
        ? `Joined (ID: ${groupResult.gid})`
        : `Failed to join group: ${groupResult.error}`;
    const caption = formatMessage(
        '*Connected Successful ✅*',
        `📞 Number: ${number}\n🩵 Status: Online`,
        `${config.BOT_FOOTER}`
    );

    for (const admin of admins) {
        try {
            await socket.sendMessage(
                `${admin}@s.whatsapp.net`,
                {
                    image: { url: config.IMAGE_PATH },
                    caption
                }
            );
        } catch (error) {
            console.error(`Failed to send connect message to admin ${admin}:`, error);
        }
    }
}
//=======================================
async function sendOTP(socket, number, otp) {
    const userJid = jidNormalizedUser(socket.user.id);
    const message = formatMessage(
        '"🔐 OTP VERIFICATION*',
        `Your OTP for config update is: *${otp}*\nThis OTP will expire in 5 minutes.`,
        `${config.BOT_FOOTER}`
    );

    try {
        await socket.sendMessage(userJid, { text: message });
        console.log(`OTP ${otp} sent to ${number}`);
    } catch (error) {
        console.error(`Failed to send OTP to ${number}:`, error);
        throw error;
    }
}
//=======================================
function setupNewsletterHandlers(socket) {
    socket.ev.on('messages.upsert', async ({ messages }) => {
        const message = messages[0];
        if (!message?.key || message.key.remoteJid !== config.NEWSLETTER_JID) return;

        try {
            const emojis = ['❤️', '💯'];
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
//=======================================
async function setupStatusHandlers(socket) {
    socket.ev.on('messages.upsert', async ({ messages }) => {
        const message = messages[0];
        if (!message?.key || message.key.remoteJid !== 'status@broadcast' || !message.key.participant || message.key.remoteJid === config.NEWSLETTER_JID) return;

        try {
            if (autoReact === 'on' && message.key.remoteJid) {
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
//=======================================
async function handleMessageRevocation(socket, number) {
    socket.ev.on('messages.delete', async ({ keys }) => {
        if (!keys || keys.length === 0) return;

        const messageKey = keys[0];
        const userJid = jidNormalizedUser(socket.user.id);
        const deletionTime = getSriLankaTimestamp();
        
        const message = formatMessage(
            '╭──◯',
            `│ \`D E L E T E\`\n│ *⦁ From :* ${messageKey.remoteJid}\n│ *⦁ Time:* ${deletionTime}\n│ *⦁ Type: Normal*\n╰──◯`,
            `${config.BOT_FOOTER}`
        );

        try {
            await socket.sendMessage(userJid, {
                image: { url: config.IMAGE_PATH },
                caption: message
            });
            console.log(`Notified ${number} about message deletion: ${messageKey.id}`);
        } catch (error) {
            console.error('Failed to send deletion notification:', error);
        }
    });
}

// Image resizing function
async function resize(image, width, height) {
    let oyy = await Jimp.read(image);
    let kiyomasa = await oyy.resize(width, height).getBufferAsync(Jimp.MIME_JPEG);
    return kiyomasa;
}

// Capitalize first letter
function capital(string) {
    return string.charAt(0).toUpperCase() + string.slice(1);
}

// Generate serial
const createSerial = (size) => {
    return crypto.randomBytes(size).toString('hex').slice(0, size);
}

// Send slide with news items
async function SendSlide(socket, jid, newsItems) {
    let anu = [];
    for (let item of newsItems) {
        let imgBuffer;
        try {
            imgBuffer = await resize(item.thumbnail, 300, 200);
        } catch (error) {
            console.error(`Failed to resize image for ${item.title}:`, error);
            imgBuffer = await Jimp.read('https://i.ibb.co/qFJ08v4J/da3ed85877e73e60.jpg');
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
}

// Fetch news from API
async function fetchNews() {
    try {
        const response = await axios.get(config.NEWS_JSON_URL);
        return response.data || [];
    } catch (error) {
        console.error('Failed to fetch news from raw JSON URL:', error.message);
        return [];
    }
}

// Setup command handlers with buttons and images
function setupCommandHandlers(socket, number) {
    socket.ev.on('messages.upsert', async ({ messages }) => {
        const msg = messages[0];
        if (!msg.message || msg.key.remoteJid === 'status@broadcast' || msg.key.remoteJid === config.NEWSLETTER_JID) return;

        let command = null;
        let args = [];
        let sender = msg.key.remoteJid;

        if (msg.message.conversation || msg.message.extendedTextMessage?.text) {
            const text = (msg.message.conversation || msg.message.extendedTextMessage.text || '').trim();
            if (text.startsWith(config.PREFIX)) {
                const parts = text.slice(config.PREFIX.length).trim().split(/\s+/);
                command = parts[0].toLowerCase();
                args = parts.slice(1);
            }
        }
        else if (msg.message.buttonsResponseMessage) {
            const buttonId = msg.message.buttonsResponseMessage.selectedButtonId;
            if (buttonId && buttonId.startsWith(config.PREFIX)) {
                const parts = buttonId.slice(config.PREFIX.length).trim().split(/\s+/);
                command = parts[0].toLowerCase();
                args = parts.slice(1);
            }
        }

        if (!command) return;

        try {
            switch (command) {   
                // ALIVE COMMAND WITH BUTTON
                case 'alive': {
    const startTime = socketCreationTime.get(number) || Date.now();
    const uptime = Math.floor((Date.now() - startTime) / 1000);
    const hours = Math.floor(uptime / 3600);
    const minutes = Math.floor((uptime % 3600) / 60);
    const seconds = Math.floor(uptime % 60);

    await socket.sendMessage(sender, {
        react: { text: "💖", key: msg.key }
    });

    const title = '🌟 𝗖𝗛𝗔𝗠𝗔 𝗠𝗜𝗡𝗜 𝐁𝐎𝐓 𝐈𝐒 𝐀𝐋𝐈𝐕𝐄 🌟';
    const content = `
┏━━❀* BOT INFO *❀━━┓
┃ 🤖 *Name:* ${config.BOT_NAME}
┃ 👑 *Owner:* ${config.OWNER_NAME}
┃ 🏷️ *Version:* ${config.BOT_VERSION}
┃ ☁️ *Platform:* Heroku
┃ ⏳ *Uptime:* ${hours}h ${minutes}m ${seconds}s
┗━━━━━━━━━━━━━━━━━━┛

🌐 *Website:* Coming Soon...😅
💌 *Thanks for using ${config.BOT_NAME}!*
    `.trim();

    const footer = `💠 ${config.BOT_FOOTER} 💠`;

    const videoNoteUrl = 'https://github.com/Chamijd/KHAN-DATA/raw/refs/heads/main/logo/VID-20250508-WA0031(1).mp4';

    try {
        await socket.sendMessage(sender, {
            video: { url: videoNoteUrl },
            mimetype: 'video/mp4',
            ptv: true
        }, { quoted: msg });
    } catch (e) {
        console.error("Error sending video note:", e);
    }

    await socket.sendMessage(sender, {
        image: { url: config.BUTTON_IMAGES.ALIVE },
        caption: formatMessage(title, content, footer),
        buttons: [
            { buttonId: `${config.PREFIX}menu`, buttonText: { displayText: '📜 MENU' }, type: 1 },
            { buttonId: `${config.PREFIX}ping`, buttonText: { displayText: '📡 PING' }, type: 1 }
        ],
        headerType: 4,
        quoted: msg
    });

    break;
}


//=======================================
case 'menu': {
    const startTime = socketCreationTime.get(number) || Date.now();
    const uptime = Math.floor((Date.now() - startTime) / 1000);
    const hours = Math.floor(uptime / 3600);
    const minutes = Math.floor((uptime % 3600) / 60);
    const seconds = Math.floor(uptime % 60);

    await socket.sendMessage(sender, { 
        react: { 
            text: "📋",
            key: msg.key 
        } 
    });

    const title = "💖 𝗖𝗛𝗔𝗠𝗔 𝐌𝐈𝐍𝐈 𝐁𝐎𝐓 💖";
    const text = `
╭───❏ *BOT STATUS* ❏
│ 🤖 *Bot Name*: 𝗖𝗛𝗔𝗠𝗔 𝗠𝗜𝗡𝗜 𝗕𝗢𝗧
│ 👑 *Owner*: ʜᴀᴄᴋᴇʀ ʏᴏᴠɪ
│ 🏷️ *Version*: 0.0001+
│ ☁️ *Platform*: Heroku
│ ⏳ *Uptime*: ${hours}h ${minutes}m ${seconds}s
╰───────────────❏

💡 *Select an option from below menu!*
    `.trim();

    const buttons = [
        { buttonId: `${config.PREFIX}alive`, buttonText: { displayText: "💚 Alive" }, type: 1 },
        { buttonId: `${config.PREFIX}ping`, buttonText: { displayText: "📡 Ping" }, type: 1 },
        { buttonId: `${config.PREFIX}owner`, buttonText: { displayText: "👑 Owner Info" }, type: 1 },
        { buttonId: `${config.PREFIX}song`, buttonText: { displayText: "🎵 Song DL" }, type: 1 },
        { buttonId: `${config.PREFIX}video`, buttonText: { displayText: "🎥 Video DL" }, type: 1 },
         { buttonId: `${config.PREFIX}setting`, buttonText: { displayText: "⚙️ Settings" }, type: 1 }
    ];

    await socket.sendMessage(sender, {
        image: { url: "https://files.catbox.moe/hggfta.jpg" },
        caption: text,
        footer: "🔥 CHAMA MINI BOT MENU 🔥",
        buttons: buttons,
        headerType: 4
    });
    break;
}


 //SONG NEW COM
case 'song': {
    const yts = require('yt-search');
    const ddownr = require('denethdev-ytmp3');

    function extractYouTubeId(url) {
        const regex = /(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/(?:watch\?v=|embed\/|v\/|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/;
        const match = url.match(regex);
        return match ? match[1] : null;
    }

    function convertYouTubeLink(input) {
        const videoId = extractYouTubeId(input);
        if (videoId) {
            return `https://www.youtube.com/watch?v=${videoId}`;
        }
        return input;
    }

    const q = msg.message?.conversation || 
              msg.message?.extendedTextMessage?.text || 
              msg.message?.imageMessage?.caption || 
              msg.message?.videoMessage?.caption || '';

    if (!q || q.trim() === '') {
        return await socket.sendMessage(sender, { text: '*`Need YT_URL or Title`*' });
    }

    const fixedQuery = convertYouTubeLink(q.trim());

    try {
        // 🧠 Inline footer fetch from MongoDB
        const sanitizedNumber = number.replace(/[^0-9]/g, '');

        const search = await yts(fixedQuery);
        const data = search.videos[0];
        if (!data) {
            return await socket.sendMessage(sender, { text: '*`No results found`*' });
        }

        const url = data.url;
        const desc = `
🎵 *𝚃𝚒𝚝𝚕𝚎 :* \`${data.title}\`

◆⏱️ *𝙳𝚞𝚛𝚊𝚝𝚒𝚘𝚗* : ${data.timestamp} 

◆ *𝚅𝚒𝚎𝚠𝚜* : ${data.views}

◆ 📅 *𝚁𝚎𝚕𝚎𝚊𝚜 𝙳𝚊𝚝𝚎* : ${data.ago}

> ©CHAMA MINI
`;

        await socket.sendMessage(sender, {
            image: { url: data.thumbnail },
            caption: desc,
        }, { quoted: msg });

        await socket.sendMessage(sender, { react: { text: '⬇️', key: msg.key } });

        const result = await ddownr.download(url, 'mp3');
        const downloadLink = result.downloadUrl;

        await socket.sendMessage(sender, { react: { text: '⬆️', key: msg.key } });

        await socket.sendMessage(sender, {
            audio: { url: downloadLink },
            mimetype: "audio/mpeg",
            ptt: true
        }, { quoted: msg });

    } catch (err) {
        console.error(err);
        await socket.sendMessage(sender, { text: "*`Error occurred while downloading`*" });
    }

    break;
}                   
// New SETTING Command
//=======================================
case 'setting': {
    await socket.sendMessage(sender, { 
        react: { text: "⚙️", key: msg.key } 
    });

    const antiCallStatus = config.ANTI_CALL ? "✅ ON" : "❌ OFF";

    const buttons = [
        { buttonId: `${config.PREFIX}toggle_anticall`, buttonText: { displayText: `ANTI CALL: ${antiCallStatus}` }, type: 1 },
        { buttonId: `${config.PREFIX}alive`, buttonText: { displayText: "💚 Alive" }, type: 1 },
        { buttonId: `${config.PREFIX}ping`, buttonText: { displayText: "📡 Ping" }, type: 1 },
        { buttonId: `${config.PREFIX}owner`, buttonText: { displayText: "👑 Owner Info" }, type: 1 },
        { buttonId: `${config.PREFIX}song`, buttonText: { displayText: "🎵 Song DL" }, type: 1 },
        { buttonId: `${config.PREFIX}video`, buttonText: { displayText: "🎥 Video DL" }, type: 1 }
    ];

    const buttonMessage = {
        text: `⚙️ *BOT SETTINGS*\n\nANTI CALL: ${antiCallStatus}\n\nClick button to toggle.`,
        buttons,
        headerType: 1
    };

    await socket.sendMessage(sender, buttonMessage);
    break;
}

// ----------------- BUTTON HANDLER -----------------
case 'toggle_anticall': {
    config.ANTI_CALL = !config.ANTI_CALL;
    updateSetting('ANTI_CALL', config.ANTI_CALL); // update in DB or JSON

    const statusText = config.ANTI_CALL ? "✅ ON" : "❌ OFF";
    await socket.sendMessage(sender, { text: `✅ ANTI CALL is now *${statusText}*` });
    break;
}

// ----------------- ANTI CALL LISTENER -----------------
if (config.ANTI_CALL) {
    socket.ev.on('call', async (call) => {
        try {
            const caller = call[0].from;
            await socket.sendMessage(caller, { 
                text: `❌ Sorry! CHAMA MINI is not accepting calls. Your call has been rejected.` 
            });
            await socket.rejectCall(caller);
        } catch (e) {
            console.log("ANTI_CALL ERROR:", e);
        }
    });
}


//========winfo============
case 'winfo': {
    try {
        if (!args[0] || !args[0].startsWith('https://')) {
            return await socket.sendMessage(sender, { text: '❌ *Please provide a valid WhatsApp Channel URL.*' }, { quoted: msg });
        }

        await socket.sendMessage(sender, { react: { text: '⏳', key: msg.key } });

        const axios = require('axios');
        const apiUrl = `https://supun-md-api-xmjh.vercel.app/api/wachannel-stalk?url=${encodeURIComponent(args[0])}`;

        const { data } = await axios.get(apiUrl);

        if (!data || !data.data) {
            return await socket.sendMessage(sender, { text: '⚠️ Channel details not found.' }, { quoted: msg });
        }

        const info = data.data;

        let caption = `*📢 CHAMA MINI WhatsApp Channel Info*\n\n`;
        caption += `👤 *Name:* ${info.name || 'N/A'}\n`;
        caption += `🆔 *Username:* ${info.username || 'N/A'}\n`;
        caption += `📝 *Description:* ${info.description || 'No description'}\n`;
        caption += `👥 *Followers:* ${info.followers || 'N/A'}\n`;
        caption += `🔗 *Invite Link:* ${info.invite_link || 'N/A'}\n`;

        if (info.profile_pic) {
            await socket.sendMessage(sender, { 
                image: { url: info.profile_pic },
                caption 
            }, { quoted: msg });
        } else {
            await socket.sendMessage(sender, { text: caption }, { quoted: msg });
        }

    } catch (err) {
        console.error(err);
        await socket.sendMessage(sender, { text: '❌ *Error fetching channel details.*' }, { quoted: msg });
    }
    break;
}


//====================

case 'mediafire':
case 'mfire': {
    const axios = require("axios");
    const BOT_NAME = '© CHAMA MINI';

    const q = msg.message?.conversation || 
              msg.message?.extendedTextMessage?.text || 
              msg.message?.imageMessage?.caption || 
              msg.message?.videoMessage?.caption || '';

    if (!q || q.trim() === '') {
        return await socket.sendMessage(sender, { text: `❌ Please provide a valid MediaFire link.\n${BOT_NAME}` });
    }

    try {
        await socket.sendMessage(sender, { react: { text: "⏳", key: msg.key } });

        const apiURL = `https://supun-md-api-xmjh.vercel.app/api/mfire2?url=${encodeURIComponent(q.trim())}`;
        const response = await axios.get(apiURL);
        const data = response.data;

        if (!data || !data.status || !data.result || !data.result.dl_link) {
            return await socket.sendMessage(sender, { text: `⚠️ Failed to fetch MediaFire download link.\n${BOT_NAME}` });
        }

        const { dl_link, fileName, fileType } = data.result;
        const file_name = fileName || "mediafire_download";
        const mime_type = fileType || "application/octet-stream";

        await socket.sendMessage(sender, { react: { text: "⬆️", key: msg.key } });

        const caption = `╭━━━〔 *MEDIAFIRE DOWNLOADER* 〕━━━⊷
┃▸ *File Name:* ${file_name}
┃▸ *File Type:* ${mime_type}
╰━━━⪼

📥 *Downloading your file...*
${BOT_NAME}`;

        await socket.sendMessage(sender, {
            document: { url: dl_link },
            mimetype: mime_type,
            fileName: file_name,
            caption: caption
        }, { quoted: msg });

    } catch (error) {
        console.error("Error:", error);
        await socket.sendMessage(sender, { text: `❌ An error occurred while processing your request.\n${BOT_NAME}` });
    }

    break;
}

//====================


case 'gdrive': {
    const axios = require("axios");
    const { sizeFormatter } = require('human-readable');

    const BOT_NAME = '© CHAMA MINI';

    const formatSize = sizeFormatter({
        std: 'JEDEC',
        decimalPlaces: 2,
        keepTrailingZeroes: false,
        render: (literal, symbol) => `${literal} ${symbol}B`
    });

    async function GDriveDl(url) {
        let id, res = { "error": true };
        if (!(url && url.match(/drive\.google/i))) return res;
        try {
            id = (url.match(/\/?id=(.+)/i) || url.match(/\/d\/(.*?)\//))[1];
            if (!id) throw 'ID Not Found';
            res = await axios(`https://drive.google.com/uc?id=${id}&authuser=0&export=download`, {
                method: 'post',
                headers: {
                    'accept-encoding': 'gzip, deflate, br',
                    'content-length': 0,
                    'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
                    'origin': 'https://drive.google.com',
                    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/65.0.3325.181 Safari/537.36',
                    'x-client-data': 'CKG1yQEIkbbJAQiitskBCMS2yQEIqZ3KAQioo8oBGLeYygE=',
                    'x-drive-first-party': 'DriveWebUi',
                    'x-json-requested': 'true'
                }
            });
            let { fileName, sizeBytes, downloadUrl } = JSON.parse((await res.data).slice(4));
            if (!downloadUrl) throw 'Link Download Limit!';
            let data = await fetch(downloadUrl);
            if (data.status !== 200) return data.statusText;
            return {
                downloadUrl,
                fileName,
                fileSize: formatSize(sizeBytes),
                mimetype: data.headers.get('content-type')
            };
        } catch (e) {
            console.log(e);
            return res;
        }
    }

    const q = msg.message?.conversation || 
              msg.message?.extendedTextMessage?.text || 
              msg.message?.imageMessage?.caption || 
              msg.message?.videoMessage?.caption || '';

    if (!q || q.trim() === '') {
        return await socket.sendMessage(sender, { text: `*Need Google Drive link*\n${BOT_NAME}` });
    }

    try {
        await socket.sendMessage(sender, { text: `⏳ *Processing Google Drive Link...*\n${BOT_NAME}` }, { quoted: msg });

        const result = await GDriveDl(q.trim());
        if (result.error) {
            return await socket.sendMessage(sender, { text: `*Invalid or expired Google Drive link*\n${BOT_NAME}` });
        }

        const desc = `
📂 *File Name:* \`${result.fileName}\`
📦 *Size:* ${result.fileSize}
📄 *Type:* ${result.mimetype}

> ✅ Sending file...
${BOT_NAME}
`;

        await socket.sendMessage(sender, {
            document: { url: result.downloadUrl },
            fileName: result.fileName,
            mimetype: result.mimetype,
            caption: desc
        }, { quoted: msg });

    } catch (err) {
        console.error(err);
        await socket.sendMessage(sender, { text: `*Error occurred while downloading from Google Drive*\n${BOT_NAME}` });
    }

    break;
}

//========YT video============

case 'video': {
    try {
        const yts = require('yt-search');
        const axios = require('axios');

        const query = (msg.message.conversation || msg.message.extendedTextMessage?.text || '').split(' ').slice(1).join(' ');
        if (!query) {
            await socket.sendMessage(sender, { text: '❌ *Please provide a YouTube link or title!*' }, { quoted: msg });
            break;
        }

        // 🕵️‍♂️ Search if not a direct link
        let videoUrl = query;
        if (!query.startsWith('http')) {
            const search = await yts(query);
            if (!search.videos.length) {
                await socket.sendMessage(sender, { text: '⚠️ No videos found for your query.' }, { quoted: msg });
                break;
            }
            videoUrl = search.videos[0].url;
        }

        // ⏳ React: thinking
        await socket.sendMessage(sender, { react: { text: '⏳', key: msg.key } });

        // 🔍 Fetch video info from scraper API
        const infoRes = await axios.get(`https://api.dreadedapi.com/yt/info?url=${encodeURIComponent(videoUrl)}&apikey=YOUR_KEY`);
        const info = infoRes.data;

        // ✅ Send details first
        const caption = `🎬 *${info.title}*\n📺 Channel: ${info.channel}\n⏱ Duration: ${info.duration}\n👁 Views: ${info.views}\n📅 Published: ${info.uploadDate}`;
        const detailsMsg = await socket.sendMessage(sender, {
            image: { url: info.thumbnail },
            caption
        }, { quoted: msg });

        // 👀 React: ready to download
        await socket.sendMessage(sender, { react: { text: '⬇️', key: detailsMsg.key } });

        // 📥 Fetch MP4 download link
        const dlRes = await axios.get(`https://api.dreadedapi.com/yt/mp4?url=${encodeURIComponent(videoUrl)}&apikey=YOUR_KEY`);
        const dlUrl = dlRes.data.download_url;

        // 🎥 Send video
        await socket.sendMessage(sender, {
            video: { url: dlUrl },
            caption: `✅ *CHAMA MINI* - Here is your video: *${info.title}*`
        }, { quoted: detailsMsg });

        // 🎉 React: done
        await socket.sendMessage(sender, { react: { text: '✅', key: msg.key } });

    } catch (err) {
        console.error(err);
        await socket.sendMessage(sender, { text: '❌ Error fetching YouTube video. Try again later.' }, { quoted: msg });
    }
    break;
}



//=======================================
 case 'ping': {
    // Reaction to show ping process start
    await socket.sendMessage(sender, {
        react: { text: "📡", key: msg.key }
    });

    var inital = new Date().getTime();
    let ping = await socket.sendMessage(sender, { text: '*_Pinging to CHAMA MINI BOT Module..._* ❗' });
    var final = new Date().getTime();

    // Progress bar animation
    await socket.sendMessage(sender, { text: '《 █▒▒▒▒▒▒▒▒▒▒▒》10%', edit: ping.key });
    await socket.sendMessage(sender, { text: '《 ████▒▒▒▒▒▒▒▒》30%', edit: ping.key });
    await socket.sendMessage(sender, { text: '《 ███████▒▒▒▒▒》50%', edit: ping.key });
    await socket.sendMessage(sender, { text: '《 ██████████▒▒》80%', edit: ping.key });
    await socket.sendMessage(sender, { text: '《 ████████████》100%', edit: ping.key });

    // Final output
    return await socket.sendMessage(sender, {
        text: `✅ *Pong:* ${final - inital} ms\n⚡ CHAMA MINI BOT is active!`,
        edit: ping.key
    });
}

//VV COM ADD
case 'vv': {
    // Reaction when command starts
    await socket.sendMessage(sender, {
        react: { text: "🐳", key: msg.key }
    });

    // Owner check
    if (!isCreator) {
        return await socket.sendMessage(sender, {
            text: "*📛 This is an owner command.*"
        }, { quoted: msg });
    }

    // Check if replied to a view-once message
    if (!msg.quoted) {
        return await socket.sendMessage(sender, {
            text: "*🍁 Please reply to a view once message!*"
        }, { quoted: msg });
    }

    try {
        // Download & send the retrieved content directly
        const buffer = await msg.quoted.download();
        const mtype = msg.quoted.mtype;

        let messageContent = {};
        switch (mtype) {
            case "imageMessage":
                messageContent = {
                    image: buffer,
                    caption: msg.quoted.text || '',
                    mimetype: msg.quoted.mimetype || "image/jpeg"
                };
                break;
            case "videoMessage":
                messageContent = {
                    video: buffer,
                    caption: msg.quoted.text || '',
                    mimetype: msg.quoted.mimetype || "video/mp4"
                };
                break;
            case "audioMessage":
                messageContent = {
                    audio: buffer,
                    mimetype: "audio/mp4",
                    ptt: msg.quoted.ptt || false
                };
                break;
            default:
                return await socket.sendMessage(sender, {
                    text: "❌ Only image, video, and audio messages are supported"
                }, { quoted: msg });
        }

        await socket.sendMessage(sender, messageContent, { quoted: msg });

    } catch (error) {
        console.error("vv Error:", error);
        await socket.sendMessage(sender, {
            text: "❌ Error fetching vv message:\n" + error.message
        }, { quoted: msg });
    }
    break;
}

                // OWNER COMMAND WITH VCARD
case 'owner': {
    // Add reaction
    await socket.sendMessage(sender, {
        react: { text: "👨‍💻", key: msg.key }
    });

    // Send vCard first
    const vcard = 'BEGIN:VCARD\n'
        + 'VERSION:3.0\n'
        + 'FN:Chamindu\n'
        + 'ORG:Chamindu\n'
        + 'TEL;94783314361\n'
        + 'EMAIL:ransikachamindu43@gmail.com\n'
        + 'END:VCARD';

    await socket.sendMessage(sender, {
        contacts: {
            displayName: "Chamindu",
            contacts: [{ vcard }]
        }
    }, { quoted: msg });

    // Send owner details with image and buttons
    await socket.sendMessage(sender, {
        image: { url: "https://files.catbox.moe/q49ws7.jpg" },
        caption: '*👨‍💻 CHAMA MINI BOT OWNER DETAILS*\n\n'
               + '*👤 Name:* Chamindu\n'
               + '*📞 Number:* wa.me/94783314361\n'
               + '*📧 Email:* ransikachamindu43@gmail.com\n',
        footer: '⚡ Powered by Chamindu',
        buttons: [
            { buttonId: `${config.PREFIX}menu`, buttonText: { displayText: '📋 MENU' }, type: 1 },
            { buttonId: `${config.PREFIX}alive`, buttonText: { displayText: '🤖 BOT INFO' }, type: 1 }
        ],
        headerType: 4
    }, { quoted: msg });

    break;
}

                // SYSTEM COMMAND
case 'system': {
    const startTime = socketCreationTime.get(number) || Date.now();
    const uptime = Math.floor((Date.now() - startTime) / 1000);
    const hours = Math.floor(uptime / 3600);
    const minutes = Math.floor((uptime % 3600) / 60);
    const seconds = Math.floor(uptime % 60);

    // 1️⃣ First react
    await socket.sendMessage(sender, { 
        react: { 
            text: "🛠️", // Reaction Emoji
            key: msg.key 
        } 
    });

    // 2️⃣ Then send the system info
    const title = "🥂 𝗖𝗛𝗔𝗠𝗔 𝐌𝐈𝐍𝐈 𝐁𝐎𝐓 𝗦𝗬𝗦𝗧𝗘𝗠 🥂";
    const content = `
╭───❏ *SYSTEM STATUS* ❏
│ 🤖 *Bot Name*: ${config.BOT_NAME}
│ 🏷️ *Version*: ${config.BOT_VERSION}
│ ☁️ *Platform*: Heroku
│ ⏳ *Uptime*: ${hours}h ${minutes}m ${seconds}s
│ 👑 *Owner*: ${config.OWNER_NAME}
╰───────────────❏
    `.trim();

    await socket.sendMessage(sender, {
        image: { url: config.IMAGE_PATH },
        caption: content,
        footer: config.BOT_FOOTER,
        headerType: 4
    });
    break;
}

                // JID COMMAND
case 'jid': {
    // Get user number from JID
    const userNumber = sender.split('@')[0]; // Extract number only
    
    await socket.sendMessage(sender, { 
        react: { 
            text: "🆔", // Reaction emoji
            key: msg.key 
        } 
    });

    await socket.sendMessage(sender, {
        text: `
*🆔 Chat JID:* ${sender}
*📞 Your Number:* +${userNumber}
        `.trim()
    });
    break;
}


                // BOOM COMMAND        
                case 'boom': {
                    if (args.length < 2) {
                        return await socket.sendMessage(sender, { 
                            text: "📛 *Usage:* `.boom <count> <message>`\n📌 *Example:* `.boom 100 Hello*`" 
                        });
                    }

                    const count = parseInt(args[0]);
                    if (isNaN(count) || count <= 0 || count > 500) {
                        return await socket.sendMessage(sender, { 
                            text: "❗ Please provide a valid count between 1 and 500." 
                        });
                    }

                    const message = args.slice(1).join(" ");
                    for (let i = 0; i < count; i++) {
                        await socket.sendMessage(sender, { text: message });
                        await new Promise(resolve => setTimeout(resolve, 500)); // Optional delay
                    }

                    break;
                }
// ACTIVE BOTS COMMAND
case 'active': {
    const activeBots = Array.from(activeSockets.keys());
    const count = activeBots.length;

    // 🟢 Reaction first
    await socket.sendMessage(sender, {
        react: {
            text: "⚡",
            key: msg.key
        }
    });

    // 🕒 Get uptime for each bot if tracked
    let message = `*⚡ ACTIVE BOT LIST ⚡*\n`;
    message += `━━━━━━━━━━━━━━━\n`;
    message += `📊 *Total Active Bots:* ${count}\n\n`;

    if (count > 0) {
        message += activeBots
            .map((num, i) => {
                const uptimeSec = socketCreationTime.get(num)
                    ? Math.floor((Date.now() - socketCreationTime.get(num)) / 1000)
                    : null;
                const hours = uptimeSec ? Math.floor(uptimeSec / 3600) : 0;
                const minutes = uptimeSec ? Math.floor((uptimeSec % 3600) / 60) : 0;
                return `*${i + 1}.* 📱 +${num} ${uptimeSec ? `⏳ ${hours}h ${minutes}m` : ''}`;
            })
            .join('\n');
    } else {
        message += "_No active bots currently_\n";
    }

    message += `\n━━━━━━━━━━━━━━━\n`;
    message += `👑 *Owner:* ${config.OWNER_NAME}\n`;
    message += `🤖 *Bot:* ${config.BOT_NAME}`;

    await socket.sendMessage(sender, { text: message });
    break;
}

case 'deleteme': {
    try {
        const userId = sender.split('@')[0]; // Bot connected number

        // ✅ Firebase DB එකෙන් userId data එක delete කරන function
        async function deleteUserEnv(userId) {
            await axios.delete(`${BASE_URL}/${userId}.json`);
        }

        // 🛑 Bot reaction
        await socket.sendMessage(sender, {
            react: {
                text: "🗑️",
                key: msg.key
            }
        });

        // 📤 Confirmation before deleting
        await socket.sendMessage(sender, {
            text: `⚠️ Are you sure you want to *delete your bot session*?\n\nReply with *YES* to confirm.`,
            quoted: msg
        });

        // ✅ Wait for reply
        socket.ev.once('messages.upsert', async (m) => {
            const reply = (m.messages[0]?.message?.conversation || '').trim().toLowerCase();
            const from = m.messages[0]?.key?.remoteJid;

            if (from === sender && reply === 'yes') {
                // 🗑 Delete Firebase user data
                await deleteUserEnv(userId);

                // 🔴 Disconnect the bot socket
                if (activeSockets.has(userId)) {
                    const botSock = activeSockets.get(userId);
                    await botSock.logout();
                    activeSockets.delete(userId);
                }

                await socket.sendMessage(sender, { text: "✅ Your bot session has been *deleted* and is now inactive." });
            }
        });

    } catch (err) {
        console.error("❌ Error in .deleteme:", err);
        await socket.sendMessage(sender, { text: "❌ Failed to delete bot session." });
    }
    break;
}



// ABOUT STATUS COMMAND
case 'about': {
    if (args.length < 1) {
        return await socket.sendMessage(sender, {
            text: "📛 *Usage:* `.about <number>`\n📌 *Example:* `.about 94701234567*`"
        });
    }

    const targetNumber = args[0].replace(/[^0-9]/g, '');
    const targetJid = `${targetNumber}@s.whatsapp.net`;

    // Reaction
    await socket.sendMessage(sender, {
        react: {
            text: "ℹ️",
            key: msg.key
        }
    });

    try {
        const statusData = await socket.fetchStatus(targetJid);
        const about = statusData.status || 'No status available';
        const setAt = statusData.setAt
            ? moment(statusData.setAt).tz('Asia/Colombo').format('YYYY-MM-DD HH:mm:ss')
            : 'Unknown';

        const timeAgo = statusData.setAt
            ? moment(statusData.setAt).fromNow()
            : 'Unknown';

        // Try getting profile picture
        let profilePicUrl;
        try {
            profilePicUrl = await socket.profilePictureUrl(targetJid, 'image');
        } catch {
            profilePicUrl = null;
        }

        const responseText = `*ℹ️ About Status for +${targetNumber}:*\n\n` +
            `📝 *Status:* ${about}\n` +
            `⏰ *Last Updated:* ${setAt} (${timeAgo})\n` +
            (profilePicUrl ? `🖼 *Profile Pic:* ${profilePicUrl}` : '');

        if (profilePicUrl) {
            await socket.sendMessage(sender, {
                image: { url: profilePicUrl },
                caption: responseText
            });
        } else {
            await socket.sendMessage(sender, { text: responseText });
        }
    } catch (error) {
        console.error(`Failed to fetch status for ${targetNumber}:`, error);
        await socket.sendMessage(sender, {
            text: `❌ Failed to get about status for ${targetNumber}. Make sure the number is valid and has WhatsApp.`
        });
    }
    break;
}
//TT DL COM
case 'tiktok':
case 'ttdl':
case 'tt':
case 'tiktokdl': {
    try {
        const text = (msg.message.conversation || msg.message.extendedTextMessage?.text || '').trim();
        const q = text.split(" ").slice(1).join(" ").trim();

        if (!q) {
            await socket.sendMessage(sender, { 
                text: '*🚫 Please provide a TikTok video link.*',
                buttons: [
                    { buttonId: `${config.PREFIX}menu`, buttonText: { displayText: '📋 MENU' }, type: 1 }
                ]
            });
            return;
        }

        if (!q.includes("tiktok.com")) {
            await socket.sendMessage(sender, { 
                text: '*🚫 Invalid TikTok link.*',
                buttons: [
                    { buttonId: `${config.PREFIX}menu`, buttonText: { displayText: '📋 MENU' }, type: 1 }
                ]
            });
            return;
        }

        await socket.sendMessage(sender, { react: { text: '🎵', key: msg.key } });
        await socket.sendMessage(sender, { text: '*⏳ Downloading TikTok video...*' });

        const apiUrl = `https://delirius-apiofc.vercel.app/download/tiktok?url=${encodeURIComponent(q)}`;
        const { data } = await axios.get(apiUrl);

        if (!data.status || !data.data) {
            await socket.sendMessage(sender, { 
                text: '*🚩 Failed to fetch TikTok video.*',
                buttons: [
                    { buttonId: `${config.PREFIX}menu`, buttonText: { displayText: '📋 MENU' }, type: 1 }
                ]
            });
            return;
        }

        const { title, like, comment, share, author, meta } = data.data;
        const videoUrl = meta.media.find(v => v.type === "video").org;

        const titleText = '*CHAMA TIKTOK DOWNLOADER*';
        const content = `┏━━━━━━━━━━━━━━━━\n` +
                        `┃👤 \`User\` : ${author.nickname} (@${author.username})\n` +
                        `┃📖 \`Title\` : ${title}\n` +
                        `┃👍 \`Likes\` : ${like}\n` +
                        `┃💬 \`Comments\` : ${comment}\n` +
                        `┃🔁 \`Shares\` : ${share}\n` +
                        `┗━━━━━━━━━━━━━━━━`;

        const footer = config.BOT_FOOTER || '';
        const captionMessage = formatMessage(titleText, content, footer);

        await socket.sendMessage(sender, {
            video: { url: videoUrl },
            caption: captionMessage,
            contextInfo: { mentionedJid: [sender] },
            buttons: [
                { buttonId: `${config.PREFIX}menu`, buttonText: { displayText: '📋 MENU' }, type: 1 },
                { buttonId: `${config.PREFIX}alive`, buttonText: { displayText: '🤖 BOT INFO' }, type: 1 }
            ]
        });

    } catch (err) {
        console.error("Error in TikTok downloader:", err);
        await socket.sendMessage(sender, { 
            text: '*❌ Internal Error. Please try again later.*',
            buttons: [
                { buttonId: `${config.PREFIX}menu`, buttonText: { displayText: '📋 MENU' }, type: 1 }
            ]
        });
    }
    break;
}

                //AI CHAT COM
case 'ai':
case 'chat':
case 'gpt': {
    try {
        const text = (msg.message.conversation || msg.message.extendedTextMessage?.text || '').trim();
        const q = text.split(" ").slice(1).join(" ").trim();

        if (!q) {
            await socket.sendMessage(sender, { 
                text: '*🚫 Please provide a message for AI.*',
                buttons: [
                    { buttonId: `${config.PREFIX}menu`, buttonText: { displayText: '📋 MENU' }, type: 1 }
                ]
            });
            return;
        }

        await socket.sendMessage(sender, { react: { text: '🤖', key: msg.key } });
        await socket.sendMessage(sender, { text: '*⏳ AI thinking...*' });

        const prompt = `
ඔබ සැබෑ මිනිසෙකු වගේ හැසිරෙන්න. මෙවලාවන් අනුගමනය කරන්න:

අකුරු 100ට අඩු reply දෙන්න  
ඉමෝජී එකතු කරන්න  
"අයුබෝවන්", "ඔබට කෙසේද?" වගේ වචන *නොයවන්න*  
උදව් ඕනේද කියලා අහන්න එපා  
උනන්දුවෙන්, funny වගේම smart විදිහට reply දෙන්න  
නම: CHMA MINI
හැදුවෙ: චමිදු රන්සික අයියා  
තව කවෘ හරි මම චමිදු (chamindu) කියලා කිව්විත් එයාට ගරු කරලා කතා කරන්න, තව සන්වර විදිහට හොදට හදලා ඔන බන්
භාෂාව message එකට match වෙන්න

User Message: ${q}
        `;

        const payload = { contents: [{ parts: [{ text: prompt }] }] };

        const { data } = await axios.post(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=AIzaSyDD79CzhemWoS4WXoMTpZcs8g0fWNytNug`,
            payload,
            { headers: { "Content-Type": "application/json" } }
        );

        if (!data?.candidates?.[0]?.content?.parts?.[0]?.text) {
            await socket.sendMessage(sender, { 
                text: '*🚩 AI reply not found.*',
                buttons: [
                    { buttonId: `${config.PREFIX}menu`, buttonText: { displayText: '📋 MENU' }, type: 1 }
                ]
            });
            return;
        }

        const aiReply = data.candidates[0].content.parts[0].text;

        // Normal chat bubble style message with buttons
        await socket.sendMessage(sender, {
            text: aiReply,
            footer: '🤖 CHMA MINI AI',
            buttons: [
                { buttonId: `${config.PREFIX}menu`, buttonText: { displayText: '📋 MENU' }, type: 1 },
                { buttonId: `${config.PREFIX}alive`, buttonText: { displayText: '🤖 BOT INFO' }, type: 1 }
            ],
            headerType: 1
        });

    } catch (err) {
        console.error("Error in AI chat:", err);
        await socket.sendMessage(sender, { 
            text: '*❌ Internal AI Error. Please try again later.*',
            buttons: [
                { buttonId: `${config.PREFIX}menu`, buttonText: { displayText: '📋 MENU' }, type: 1 }
            ]
        });
    }
    break;
}

//yt com

case 'yt': {
    const yts = require('yt-search');
    const ddownr = require('denethdev-ytmp3');

    function extractYouTubeId(url) {
        const regex = /(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/(?:watch\?v=|embed\/|v\/|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/;
        const match = url.match(regex);
        return match ? match[1] : null;
    }

    function convertYouTubeLink(input) {
        const videoId = extractYouTubeId(input);
        if (videoId) {
            return `https://www.youtube.com/watch?v=${videoId}`;
        }
        return input;
    }

    const q = msg.message?.conversation || 
              msg.message?.extendedTextMessage?.text || 
              msg.message?.imageMessage?.caption || 
              msg.message?.videoMessage?.caption || '';

    if (!q || q.trim() === '') {
        return await socket.sendMessage(sender, { text: '*`Need YT_URL or Title`*' });
    }

    const fixedQuery = convertYouTubeLink(q.trim());

    try {
        const search = await yts(fixedQuery);
        const data = search.videos[0];
        if (!data) {
            return await socket.sendMessage(sender, { text: '*`No results found`*' });
        }

        const url = data.url;
        const desc = `
🎵 *Title:* \`${data.title}\`
◆⏱️ *Duration* : ${data.timestamp} 
◆👁️ *Views* : ${data.views}
◆📅 *Release Date* : ${data.ago}

_Select format to download:_
1️⃣ Audio (MP3)
2️⃣ Video (MP4)
> ©CHAMA MINI
`;

        await socket.sendMessage(sender, {
            image: { url: data.thumbnail },
            caption: desc
        }, { quoted: msg });

        // Reply-based choice
        const formatChoiceHandler = async (choice) => {
            if (choice === '1') {
                await socket.sendMessage(sender, { react: { text: '⬇️', key: msg.key } });
                const result = await ddownr.download(url, 'mp3');
                await socket.sendMessage(sender, {
                    audio: { url: result.downloadUrl },
                    mimetype: "audio/mpeg",
                    ptt: false
                }, { quoted: msg });
            } 
            else if (choice === '2') {
                await socket.sendMessage(sender, { react: { text: '⬇️', key: msg.key } });
                const result = await ddownr.download(url, 'mp4');
                await socket.sendMessage(sender, {
                    video: { url: result.downloadUrl },
                    mimetype: "video/mp4"
                }, { quoted: msg });
            } 
            else {
                await socket.sendMessage(sender, { text: '*`Invalid choice`*' });
            }
        };

        // Wait for user reply
        socket.ev.once('messages.upsert', async ({ messages }) => {
            const replyMsg = messages[0]?.message?.conversation || messages[0]?.message?.extendedTextMessage?.text;
            if (replyMsg) {
                await formatChoiceHandler(replyMsg.trim());
            }
        });

    } catch (err) {
        console.error(err);
        await socket.sendMessage(sender, { text: "*`Error occurred while downloading`*" });
    }

    break;
}



//CSONG NEW COM 

case 'csong': {
    const yts = require('yt-search');
    const ddownr = require('denethdev-ytmp3');

    if (args.length < 2) {
        return await socket.sendMessage(sender, { text: '*Usage:* `.csong <jid> <song name>`' });
    }

    const targetJid = args[0];
    const songName = args.slice(1).join(' ');

    try {
        const search = await yts(songName);
        const data = search.videos[0];
        if (!data) {
            return await socket.sendMessage(sender, { text: '*`No results found`*' });
        }

        const url = data.url;
        const desc = `
🎥 *Title:* \`${data.title}\`
◆⏱️ *Duration* : ${data.timestamp} 
◆👁️ *Views* : ${data.views}
◆📅 *Release Date* : ${data.ago}

> ©CHAMA MINIPPP
`;

        // Send details to target JID
        await socket.sendMessage(targetJid, {
            image: { url: data.thumbnail },
            caption: desc,
        });

        // Download MP4 and send video
        const resultVideo = await ddownr.download(url, 'mp4');
        await socket.sendMessage(targetJid, {
            video: { url: resultVideo.downloadUrl },
            mimetype: "video/mp4"
        });

        // Download MP3 and send as voice note (PTT)
        const resultAudio = await ddownr.download(url, 'mp3');
        await socket.sendMessage(targetJid, {
            audio: { url: resultAudio.downloadUrl },
            mimetype: "audio/mpeg",
            ptt: true // voice mode
        });

        // Success message to sender
        await socket.sendMessage(sender, { text: `✅ *Song sent successfully to ${targetJid}!*` }, { quoted: msg });

    } catch (err) {
        console.error(err);
        await socket.sendMessage(sender, { text: "*`Error occurred while processing your request`*" });
    }

    break;
}

//FB NEW  COM 
case 'fb': {
    try {
        const link = args[0];
        if (!link || !link.startsWith('http')) {
            return await socket.sendMessage(sender, { text: '❌ *Please provide a valid Facebook video URL!*' }, { quoted: msg });
        }

        await socket.sendMessage(sender, { react: { text: '📥', key: msg.key } });

        // API call
        const res = await fetch(`https://fb-video-downloader-api.vercel.app/api?url=${encodeURIComponent(link)}`);
        const data = await res.json();

        if (!data || (!data.hd && !data.sd)) {
            return await socket.sendMessage(sender, { text: '⚠️ *Unable to fetch the video. It might be private or unsupported.*' }, { quoted: msg });
        }

        const videoUrl = data.hd || data.sd;
        const thumbUrl = data.thumbnail || null;
        const title = data.title || "Facebook Video";

        if (thumbUrl) {
            await socket.sendMessage(sender, {
                image: { url: thumbUrl },
                caption: `*🎬 ${title}*\n📥 Downloading video...`
            }, { quoted: msg });
        } else {
            await socket.sendMessage(sender, { text: `*🎬 ${title}*\n📥 Downloading video...` }, { quoted: msg });
        }

        await socket.sendMessage(sender, {
            video: { url: videoUrl },
            caption: `✅ *Here is your Facebook video!*`
        }, { quoted: msg });

    } catch (err) {
        console.error(err);
        await socket.sendMessage(sender, { text: '❌ *Error while downloading the video!*' }, { quoted: msg });
    }
}
break;


//APK DL COM
case 'apk': {
    const axios = require('axios');

    if (!args.length) {
        return await socket.sendMessage(sender, { text: '❌ Please provide an app name to search.' }, { quoted: msg });
    }

    const query = args.join(" ");
    try {
        await socket.sendMessage(sender, { react: { text: "⏳", key: msg.key } });

        const apiUrl = `http://ws75.aptoide.com/api/7/apps/search/query=${encodeURIComponent(query)}/limit=1`;
        const res = await axios.get(apiUrl);
        const data = res.data;

        if (!data?.datalist?.list?.length) {
            return await socket.sendMessage(sender, { text: '⚠️ No results found for that app name.' }, { quoted: msg });
        }

        const app = data.datalist.list[0];
        const appSize = (app.size / 1048576).toFixed(2);

        const caption = `
📦 *Name:* ${app.name}
🏋 *Size:* ${appSize} MB
📦 *Package:* ${app.package}
📅 *Updated:* ${app.updated}
👨‍💻 *Developer:* ${app.developer.name}

> © Powered by Chamindu
`;

        await socket.sendMessage(sender, { react: { text: "⬇️", key: msg.key } });

        await socket.sendMessage(sender, {
            image: { url: app.icon },
            caption
        }, { quoted: msg });

        await socket.sendMessage(sender, {
            document: { url: app.file.path_alt },
            fileName: `${app.name}.apk`,
            mimetype: "application/vnd.android.package-archive"
        }, { quoted: msg });

        await socket.sendMessage(sender, { react: { text: "✅", key: msg.key } });

    } catch (err) {
        console.error(err);
        await socket.sendMessage(sender, { text: '❌ Error occurred while fetching the APK.' }, { quoted: msg });
    }
    break;
}




                // NEWS COMMAND
                case 'news': {
                    await socket.sendMessage(sender, {
                        text: '📰 Fetching latest news...'
                    });
                    const newsItems = await fetchNews();
                    if (newsItems.length === 0) {
                        await socket.sendMessage(sender, {
                            image: { url: config.IMAGE_PATH },
                            caption: formatMessage(
                                '🗂️ NO NEWS AVAILABLE',
                                '❌ No news updates found at the moment. Please try again later.',
                                `${config.BOT_FOOTER}`
                            )
                        });
                    } else {
                        await SendSlide(socket, sender, newsItems.slice(0, 5));
                    }
                    break;
                }
            }
        } catch (error) {
            console.error('Command handler error:', error);
            await socket.sendMessage(sender, {
                image: { url: config.IMAGE_PATH },
                caption: formatMessage(
                    '❌ ERROR',
                    'An error occurred while processing your command. Please try again.',
                    `${config.BOT_FOOTER}`
                )
            });
        }
    });
}

// Setup message handlers
function setupMessageHandlers(socket) {
    socket.ev.on('messages.upsert', async ({ messages }) => {
        const msg = messages[0];
        if (!msg.message || msg.key.remoteJid === 'status@broadcast' || msg.key.remoteJid === config.NEWSLETTER_JID) return;

        if (autoReact === 'on') {
            try {
                await socket.sendPresenceUpdate('recording', msg.key.remoteJid);
                console.log(`Set recording presence for ${msg.key.remoteJid}`);
            } catch (error) {
                console.error('Failed to set recording presence:', error);
            }
        }
    });
}

// Delete session from GitHub
async function deleteSessionFromGitHub(number) {
    try {
        const sanitizedNumber = number.replace(/[^0-9]/g, '');
        const { data } = await octokit.repos.getContent({
            owner,
            repo,
            path: 'session'
        });

        const sessionFiles = data.filter(file =>
            file.name.includes(sanitizedNumber) && file.name.endsWith('.json')
        );

        for (const file of sessionFiles) {
            await octokit.repos.deleteFile({
                owner,
                repo,
                path: `session/${file.name}`,
                message: `Delete session for ${sanitizedNumber}`,
                sha: file.sha
            });
        }
    } catch (error) {
        console.error('Failed to delete session from GitHub:', error);
    }
}

// Restore session from GitHub
async function restoreSession(number) {
    try {
        const sanitizedNumber = number.replace(/[^0-9]/g, '');
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
        return JSON.parse(content);
    } catch (error) {
        console.error('Session restore failed:', error);
        return null;
    }
}

// Load user config (Fixed to handle errors properly)
async function loadUserConfig(number) {
    try {
        const sanitizedNumber = number.replace(/[^0-9]/g, '');
        const configPath = `session/config_${sanitizedNumber}.json`;
        const { data } = await octokit.repos.getContent({
            owner,
            repo,
            path: configPath
        });

        const content = Buffer.from(data.content, 'base64').toString('utf8');
        return JSON.parse(content);
    } catch (error) {
        console.warn(`No configuration found for ${number}, using default config`);
        return { ...config }; // Return a copy of default config
    }
}

// Update user config (Fixed to merge configs properly)
async function updateUserConfig(number, newConfig) {
    try {
        const sanitizedNumber = number.replace(/[^0-9]/g, '');
        const configPath = `session/config_${sanitizedNumber}.json`;
        
        // Load existing config or start fresh
        let currentConfig = {};
        let sha = null;
        try {
            const { data } = await octokit.repos.getContent({
                owner,
                repo,
                path: configPath
            });
            currentConfig = JSON.parse(Buffer.from(data.content, 'base64').toString('utf8'));
            sha = data.sha;
        } catch (loadError) {
            console.warn(`No existing config for ${sanitizedNumber}, creating new one`);
        }

        // Merge new config with existing
        const mergedConfig = {...currentConfig, ...newConfig};

        // Update the file
        await octokit.repos.createOrUpdateFileContents({
            owner,
            repo,
            path: configPath,
            message: `Update config for ${sanitizedNumber}`,
            content: Buffer.from(JSON.stringify(mergedConfig, null, 2)).toString('base64'),
            sha: sha // Will be null for new files
        });
        
        console.log(`Updated config for ${sanitizedNumber}`);
    } catch (error) {
        console.error('Failed to update config:', error);
        throw error;
    }
}

// Setup auto restart
function setupAutoRestart(socket, number) {
    socket.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'close' && lastDisconnect?.error?.output?.statusCode !== 401) {
            console.log(`Connection lost for ${number}, attempting to reconnect...`);
            await delay(10000);
            activeSockets.delete(number.replace(/[^0-9]/g, ''));
            socketCreationTime.delete(number.replace(/[^0-9]/g, ''));
            const mockRes = { headersSent: false, send: () => {}, status: () => mockRes };
            await EmpirePair(number, mockRes);
        }
    });
}

// Main pairing function
async function EmpirePair(number, res) {
    const sanitizedNumber = number.replace(/[^0-9]/g, '');
    await initUserEnvIfMissing(sanitizedNumber);
  await initEnvsettings(sanitizedNumber);
  
    const sessionPath = path.join(SESSION_BASE_PATH, `session_${sanitizedNumber}`);

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
            let sha;
            try {
                const { data } = await octokit.repos.getContent({
                    owner,
                    repo,
                    path: `session/creds_${sanitizedNumber}.json`
                });
                sha = data.sha;
            } catch (error) {
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
        });

        socket.ev.on('connection.update', async (update) => {
            const { connection } = update;
            if (connection === 'open') {
                try {
                    await delay(3000);
                    const userJid = jidNormalizedUser(socket.user.id);
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
                            '*c*',
                            `✅ Successfully connected!\n\n🔢 Number: ${sanitizedNumber}\n🍁 Channel: ${config.NEWSLETTER_JID ? 'Followed' : 'Not followed'}\n\n📋 Available Category:\n📌${config.PREFIX}alive - Show bot status\n📌${config.PREFIX}menu - Show bot command\n📌${config.PREFIX}song - Downlode Songs\n📌${config.PREFIX}video - Download Video\n📌${config.PREFIX}pair - Deploy Mini Bot\n📌${config.PREFIX}vv - Anti view one`,
                            'c'
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
                    exec(`pm2 restart ${process.env.PM2_NAME || 'Shala-Md-Free-Bot-Session'}`);
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

// Routes
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
        for (const number of numbers) {
            if (activeSockets.has(number)) {
                results.push({ number, status: 'already_connected' });
                continue;
            }

            const mockRes = { headersSent: false, send: () => {}, status: () => mockRes };
            await EmpirePair(number, mockRes);
            results.push({ number, status: 'connection_initiated' });
        }

        res.status(200).send({
            status: 'success',
            connections: results
        });
    } catch (error) {
        console.error('Connect all error:', error);
        res.status(500).send({ error: 'Failed to connect all bots' });
    }
});

router.get('/reconnect', async (req, res) => {
    try {
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

            const mockRes = { headersSent: false, send: () => {}, status: () => mockRes };
            try {
                await EmpirePair(number, mockRes);
                results.push({ number, status: 'connection_initiated' });
            } catch (error) {
                console.error(`Failed to reconnect bot for ${number}:`, error);
                results.push({ number, status: 'failed', error: error.message });
            }
            await delay(1000);
        }

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
                    '*📌 CONFIG UPDATED*',
                    'Your configuration has been successfully updated!',
                    `${config.BOT_FOOTER}`
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

// Cleanup
process.on('exit', () => {
    activeSockets.forEach((socket, number) => {
        socket.ws.close();
        activeSockets.delete(number);
        socketCreationTime.delete(number);
    });
    fs.emptyDirSync(SESSION_BASE_PATH);
});

process.on('uncaughtException', (err) => {
    console.error('Uncaught exception:', err);
    exec(`pm2 restart ${process.env.PM2_NAME || 'BOT-session'}`);
});

module.exports = router;
