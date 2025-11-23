const {
    Client,
    GatewayIntentBits,
    EmbedBuilder,
    ActivityType,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
} = require('discord.js');
const { GameDig } = require('gamedig');
const fs = require('fs');
const config = require('./config.json');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
    ],
});

let peakData = {
    entries: [],
    peak24h: 0,
};

function loadPeakData() {
    try {
        if (fs.existsSync(config.peakDataFile)) {
            const raw = fs.readFileSync(config.peakDataFile, 'utf-8');
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed.entries)) {
                peakData.entries = parsed.entries;
                peakData.peak24h = parsed.peak24h || 0;
            }
        }
    } catch (e) {
        console.error('Erreur lors du chargement de peakData:', e);
    }
}

function savePeakData() {
    try {
        fs.writeFileSync(
            config.peakDataFile,
            JSON.stringify(peakData, null, 2),
            'utf-8'
        );
    } catch (e) {
        console.error('Erreur lors de la sauvegarde de peakData:', e);
    }
}

function updatePeak(playersOnline) {
    const now = Date.now();
    const twentyFourHoursAgo = now - 24 * 60 * 60 * 1000;

    peakData.entries.push({ timestamp: now, players: playersOnline });

    peakData.entries = peakData.entries.filter(
        (e) => e.timestamp >= twentyFourHoursAgo
    );

    peakData.peak24h = peakData.entries.reduce(
        (max, e) => (e.players > max ? e.players : max),
        0
    );

    savePeakData();
}

client.once('ready', () => {
    console.log(`Le bot est en ligne ${client.user.tag}!`);
    loadPeakData();

    client.user.setStatus('online');
    client.user.setPresence({
        activities: [
            {
                name: 'Surveillance du serveur...',
                type: ActivityType.WATCHING,
            },
        ],
    });

    checkServerStatus();
    setInterval(checkServerStatus, 60_000);
});

async function checkServerStatus(interaction) {
    try {
        const state = await GameDig.query({
            type: 'garrysmod',
            host: config.ServerIP,
            port: config.ServerPort,
        });

        const playersList = Array.isArray(state.players) ? state.players : [];
        const playersOnline = playersList.length;
        const maxPlayers = state.maxplayers || 0;
        const ping = state.ping || 0;
        const mapName = state.map || 'Inconnue';

        if (config.showPeak24h) {
            updatePeak(playersOnline);
        }

        const activityType =
            ActivityType[config.setActivityType] || ActivityType.WATCHING;

        client.user.setPresence({
            activities: [
                {
                    name: config.showPing
                        ? `${playersOnline}/${maxPlayers} | Ping: ${ping}ms`
                        : `${playersOnline}/${maxPlayers}`,
                    type: activityType,
                },
            ],
            status: 'dnd',
        });

        const statusEmoji = '🟢';
        const playersEmoji = '👥';
        const pingEmoji = '📡';
        const ipEmoji = '🌐';
        const mapEmoji = '🗺️';
        const gamemodeEmoji = '🎮';
        const peakEmoji = '📈';

        const embed = new EmbedBuilder()
            .setTitle(`${statusEmoji} ${config.servertitle}`)
            .setColor(config.colorembed || '#2b2d31')
            .setTimestamp();

        if (config.image) {
            embed.setImage(config.image);
        }

        embed.setDescription(
            [
                'Un aperçu en temps réel de votre serveur Garry\'s Mod.',
                '',
                `${playersEmoji} **Joueurs en ligne :** \`${playersOnline}/${maxPlayers}\``,
            ].join('\n')
        );

        embed.addFields(
            {
                name: `${ipEmoji} Adresse`,
                value: `\`${config.ServerIP}:${config.ServerPort}\``,
                inline: true,
            },
            {
                name: 'Statut',
                value: `${statusEmoji} En ligne`,
                inline: true,
            }
        );

        if (config.showPing) {
            embed.addFields({
                name: `${pingEmoji} Ping`,
                value: `\`${ping}ms\``,
                inline: true,
            });
        }

        if (config.showGamemode) {
            embed.addFields({
                name: `${gamemodeEmoji} Gamemode`,
                value: `\`${config.gamemode}\``,
                inline: true,
            });
        }

        if (config.showMap) {
            embed.addFields({
                name: `${mapEmoji} Carte`,
                value: `\`${mapName}\``,
                inline: true,
            });
        }

        if (config.showPeak24h) {
            embed.addFields({
                name: `${peakEmoji} Pic sur 24h`,
                value: `\`${peakData.peak24h} joueur(s)\``,
                inline: true,
            });
        }

        if (config.footerText) {
            embed.setFooter({
                text: config.footerText,
                iconURL: config.footerIcon || null,
            });
        }

        let components = [];

        if (Array.isArray(config.buttons) && config.buttons.length > 0) {
            const row = new ActionRowBuilder();

            for (const btn of config.buttons) {
                if (!btn.label || !btn.url) continue;

                const button = new ButtonBuilder()
                    .setLabel(btn.label)
                    .setStyle(ButtonStyle.Link)
                    .setURL(btn.url);

                row.addComponents(button);
            }

            if (row.components.length > 0) {
                components.push(row);
            }
        }

        const channel = client.channels.cache.get(config.ChannelID);
        if (!channel) {
            console.error('Le canal avec cet ID est introuvable.');
            return;
        }

        if (!config.MessageID) {
            const sentMessage = await channel.send({
                embeds: [embed],
                components,
            });
            config.MessageID = sentMessage.id;
            fs.writeFileSync(
                './config.json',
                JSON.stringify(config, null, 2),
                'utf-8'
            );
            console.log('Statut du serveur envoyé et MessageID enregistré.');
        } else {
            const message = await channel.messages
                .fetch(config.MessageID)
                .catch(() => null);
            if (message) {
                await message.edit({ embeds: [embed], components });
                if (interaction) {
                    await interaction.reply({
                        content: 'Statut actualisé !',
                        ephemeral: true,
                    });
                }
                console.log('[N-Status] Statut du serveur mis à jour.');
            } else {
                console.error(
                    'Message non trouvé, réinitialisation du MessageID.'
                );
                config.MessageID = null;
                fs.writeFileSync(
                    './config.json',
                    JSON.stringify(config, null, 2),
                    'utf-8'
                );
            }
        }
    } catch (error) {
        console.error(
            'Erreur lors de la récupération du statut du serveur:',
            error
        );

        client.user.setPresence({
            activities: [
                {
                    name: config.setActivityOffline || 'Serveur hors ligne',
                    type: ActivityType.WATCHING,
                },
            ],
            status: 'idle',
        });
    }
}

client.login(config.Token);
