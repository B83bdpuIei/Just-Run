import { Client, GatewayIntentBits, Events, REST, Routes, SlashCommandBuilder, ChannelType } from 'discord.js';

// Ya no necesitamos 'dotenv', lo hemos eliminado.

// =================================================================================
// CONFIGURACIÓN DEL CLIENTE Y COMANDOS
// =================================================================================

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
    ],
});

// El token y otros secretos se leen de 'process.env', que Render configura automáticamente
// con las variables que has añadido en su panel.
const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

const partyCommand = new SlashCommandBuilder()
    .setName('party')
    .setDescription('Crea una party para apuntarse.')
    .addStringOption(option =>
        option.setName('nombre')
            .setDescription('Nombre de la party.')
            .setRequired(true))
    .addStringOption(option =>
        option.setName('fecha')
            .setDescription('Fecha de la party (ej. 25/12/2024).')
            .setRequired(true))
    .addStringOption(option =>
        option.setName('hora')
            .setDescription('Hora de la party (ej. 21:00).')
            .setRequired(true));

(async () => {
    try {
        console.log('Refrescando comandos de aplicación (/).');
        await rest.put(
            Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
            { body: [partyCommand.toJSON()] },
        );
        console.log('Comandos de aplicación recargados correctamente.');
    } catch (error) {
        console.error(error);
    }
})();

// =================================================================================
// FUNCIONES DE AYUDA Y CACHÉ PARA LAS PARTIES
// =================================================================================

const originalPartyMessages = new Map();

function saveOriginalContent(messageId, content) {
    originalPartyMessages.set(messageId, content);
}

async function getOriginalContent(messageId) {
    return originalPartyMessages.get(messageId) || null;
}

async function clearUserSpot(lines, authorId, messageId) {
    const userMentionRegex = new RegExp(`<@${authorId}>`);
    const oldSpotIndex = lines.findIndex(linea => userMentionRegex.test(linea));

    if (oldSpotIndex === -1) {
        return { success: false };
    }

    const oldSpot = parseInt(lines[oldSpotIndex].trim().split('.')[0]);
    const originalContent = await getOriginalContent(messageId);

    if (originalContent) {
        const originalLines = originalContent.split('\n');
        const originalLine = originalLines.find(line => line.trim().startsWith(`${oldSpot}.`));
        if (originalLine) {
            lines[oldSpotIndex] = originalLine;
            return { success: true, oldSpot };
        }
    }

    lines[oldSpotIndex] = lines[oldSpotIndex].replace(new RegExp(`\\s*<@${authorId}>`), '').trim();
    return { success: true, oldSpot };
}

// =================================================================================
// EVENTOS DEL BOT
// =================================================================================

client.once(Events.ClientReady, () => {
    console.log(`Bot listo! Logueado como ${client.user.tag}`);
});

// --- GESTIÓN DEL COMANDO /party ---
client.on(Events.InteractionCreate, async interaction => {
    if (!interaction.isCommand() || interaction.commandName !== 'party') return;

    const nombre = interaction.options.getString('nombre');
    const fecha = interaction.options.getString('fecha');
    const hora = interaction.options.getString('hora');

    const partyContent = [
        `**${nombre}** - **FECHA:** ${fecha} - **HORA:** ${hora}`,
        '---',
        '**TANQUES:**',
        '1. 🛡️',
        '2. 🛡️',
        '**HEALERS:**',
        '3. 힐러',
        '4. 힐러',
        '**DPS:**',
        '5. ⚔️',
        '6. ⚔️',
        '7. ⚔️',
        '8. ⚔️',
        '---',
        'Para apuntarte, simplemente escribe el número del puesto en este hilo.',
        'Para desapuntarte, escribe "desapuntar".'
    ].join('\n');

    try {
        await interaction.reply({ content: 'Creando la party...', ephemeral: true });
        const thread = await interaction.channel.threads.create({
            name: `${nombre} - ${fecha}`,
            autoArchiveDuration: 1440,
            type: ChannelType.PublicThread,
        });

        const starterMessage = await thread.send(partyContent);
        saveOriginalContent(starterMessage.id, starterMessage.content);

    } catch (error) {
        console.error('Error creando la party:', error);
        await interaction.followUp({ content: 'Hubo un error al crear la party.', ephemeral: true });
    }
});

// --- GESTIÓN DE MENSAJES EN HILOS (APUNTARSE / DESAPUNTARSE) ---
client.on(Events.MessageCreate, async message => {
    if (message.author.bot || !message.channel.isThread()) return;

    const { channel, author, content } = message;
    const trimmedContent = content.trim();

    if (trimmedContent.toLowerCase() === 'desapuntar') {
        await message.delete().catch(() => {});

        try {
            const mensajePrincipal = await channel.fetchStarterMessage().catch(() => null);
            if (!mensajePrincipal) return;

            let lineas = mensajePrincipal.content.split('\n');
            const result = await clearUserSpot(lineas, author.id, mensajePrincipal.id);

            if (result.success) {
                await mensajePrincipal.edit(lineas.join('\n'));
                const confirmMsg = await channel.send(`✅ <@${author.id}>, te has desapuntado del puesto **${result.oldSpot}**.`);
                setTimeout(() => confirmMsg.delete().catch(() => {}), 10000);
            } else {
                const errorMsg = await channel.send(`❌ <@${author.id}>, no estás apuntado en esta party.`);
                setTimeout(() => errorMsg.delete().catch(() => {}), 10000);
            }
        } catch (error) {
            console.error('Error al desapuntar:', error);
        }
        return;
    }
    
    const numero = parseInt(trimmedContent);
    if (isNaN(numero) || numero < 1 || numero > 50) return;
    
    await message.delete().catch(() => {});

    if (channel.locked) {
        const mensajeError = await channel.send(`❌ <@${author.id}>, las inscripciones han finalizado.`);
        setTimeout(() => mensajeError.delete().catch(() => {}), 10000);
        return;
    }

    try {
        const mensajePrincipal = await channel.fetchStarterMessage().catch(() => null);
        if (!mensajePrincipal) return;

        let lineas = mensajePrincipal.content.split('\n');
        const contentOriginalAntesDeCambio = mensajePrincipal.content;

        await clearUserSpot(lineas, author.id, mensajePrincipal.id);
        
        const indiceLineaNueva = lineas.findIndex(linea => linea.trim().startsWith(`${numero}.`));

        if (indiceLineaNueva === -1) {
            const msg = await channel.send(`❌ <@${author.id}>, el puesto **${numero}** no es válido.`);
            setTimeout(() => msg.delete().catch(() => {}), 10000);
            return;
        }

        if (lineas[indiceLineaNueva].includes('<@')) {
            await mensajePrincipal.edit(contentOriginalAntesDeCambio);
            const msg = await channel.send(`❌ <@${author.id}>, el puesto **${numero}** ya está ocupado.`);
            setTimeout(() => msg.delete().catch(() => {}), 10000);
            return;
        }

        lineas[indiceLineaNueva] = `${lineas[indiceLineaNueva].trim()} <@${author.id}>`;
        await mensajePrincipal.edit(lineas.join('\n'));
        
        const msg = await channel.send(`✅ <@${author.id}>, te has apuntado al puesto **${numero}**.`);
        setTimeout(() => msg.delete().catch(() => {}), 10000);

    } catch (error) {
        console.error('Error procesando inscripción:', error);
    }
});

client.login(process.env.DISCORD_TOKEN);
