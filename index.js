// Dependencias del Bot de Discord y Firebase
const {
    Client, GatewayIntentBits, Partials, Events,
    ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder,
    SlashCommandBuilder, PermissionFlagsBits, MessageFlags, StringSelectMenuBuilder,
    StringSelectMenuInteraction, InteractionType, ButtonBuilder, ButtonStyle,
    codeBlock
} = require('discord.js');
const { initializeApp } = require('firebase/app');
const { getFirestore, collection, addDoc, getDocs, doc, setDoc, deleteDoc, getDoc } = require('firebase/firestore');

// Importar Express para el servidor web de Render
const express = require('express');
const app = express();
const port = process.env.PORT || 3000;

// Configuración del cliente de Discord.js
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
    ],
    partials: [Partials.Channel, Partials.Message]
});

// --- Servidor Web para mantener el Bot Activo (Render) ---
app.get('/', (req, res) => {
    res.send('El bot está activo y funcionando.');
});

app.listen(port, () => {
    console.log(`Servidor web escuchando en el puerto ${port}`);
});

// --- Lógica Principal del Bot de Discord ---
let db;
let composCollectionRef;
let warnsCollectionRef;

// !! IMPORTANTE: REEMPLAZA ESTOS VALORES CON LOS IDs REALES DE TU SERVIDOR Y CANAL !!
let serverId = '1236309698131787816'; 
let warnsChannelId = '1403848025838718996';
let warnsMessageId = ''; // Deja este valor vacío. El bot lo llenará automáticamente.

const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';

// === CONFIGURACIÓN SEGURA DE FIRESTORE DESDE VARIABLES DE ENTORNO ===
const firebaseConfig = {
    apiKey: process.env.FIREBASE_API_KEY,
    authDomain: process.env.FIREBASE_AUTH_DOMAIN,
    projectId: process.env.FIREBASE_PROJECT_ID,
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.FIREBASE_APP_ID,
    measurementId: process.env.FIREBASE_MEASUREMENT_ID
};
// ===================================================================

const originalCompoContent = new Map();

/**
 * Retrieves the original content template for a specific message from a local cache or Firestore.
 * @param {string} messageId The ID of the message to retrieve the content for.
 * @returns {Promise<string|null>} The original content as a string, or null if not found.
 */
async function getOriginalContent(messageId) {
    if (originalCompoContent.has(messageId)) {
        return originalCompoContent.get(messageId);
    }

    if (db) {
        try {
            const docRef = doc(db, 'live_parties', messageId);
            const docSnap = await getDoc(docRef);

            if (docSnap.exists()) {
                const content = docSnap.data().originalContent;
                originalCompoContent.set(messageId, content);
                return content;
            }
        } catch (error) {
            console.error('Error al recuperar la plantilla de Firebase:', error);
        }
    }
    return null;
}

/**
 * Updates the static warn list message in the designated channel.
 * If the message doesn't exist, it creates it.
 * @returns {Promise<void>}
 */
async function updateWarnListMessage() {
    if (!db || !warnsChannelId) {
        console.error('Falta la configuración de Firebase o del canal de warns. No se puede actualizar la lista.');
        return;
    }

    try {
        const guild = await client.guilds.fetch(serverId);
        const warnsChannel = await guild.channels.fetch(warnsChannelId);
        if (!warnsChannel) {
            console.error('No se pudo encontrar el canal de warns.');
            return;
        }

        let warnsMessage;
        if (warnsMessageId) {
            warnsMessage = await warnsChannel.messages.fetch(warnsMessageId).catch(() => null);
        }

        if (!warnsMessage) {
            console.log('El mensaje de warns no existe. Creando un nuevo mensaje...');
            warnsMessage = await warnsChannel.send('Inicializando lista de warns...');
            warnsMessageId = warnsMessage.id;
            // Guardamos el nuevo ID en la base de datos para persistencia, si es necesario.
            // Aquí podrías añadir una llamada a tu base de datos para guardar el ID si lo necesitas.
        }

        const allWarnedUsersQuery = await getDocs(collection(db, 'warns'));
        const allWarnedUsers = await Promise.all(allWarnedUsersQuery.docs.map(async doc => {
            const userId = doc.id;
            const userWarnsQuery = await getDocs(collection(db, 'warns', userId, 'list'));
            const warnsCount = userWarnsQuery.size;
            if (warnsCount === 0) {
                await deleteDoc(doc(db, 'warns', userId)).catch(err => console.error(`Error al eliminar documento de warns para ${userId}:`, err));
                return null;
            }
            return { userId, warnsCount };
        }));

        const validWarnedUsers = allWarnedUsers.filter(u => u !== null);

        let warnListContent = `## :041: WARN LIST\n\n`;
        const separator = `:Mels_blackline:`.repeat(11) + '\n';
        warnListContent += separator;

        if (validWarnedUsers.length === 0) {
            warnListContent += 'No hay usuarios con warns actualmente.';
        } else {
            for (const userEntry of validWarnedUsers) {
                warnListContent += `:Communityowner: **<@${userEntry.userId}>**\n`;
                
                const userWarnsQuery = await getDocs(collection(db, 'warns', userEntry.userId, 'list'));
                const warns = userWarnsQuery.docs.map(doc => doc.data());
                
                warns.forEach((warn, index) => {
                    let warnEmoji;
                    if (index === 0) {
                        warnEmoji = ':7SNHD_Number1:';
                    } else if (index === 1) {
                        warnEmoji = ':7SNHD_Number2:';
                    } else if (index === 2) {
                        warnEmoji = ':7SNHD_Number3:';
                    } else {
                        warnEmoji = ':bangbang:';
                    }
                    warnListContent += `${warnEmoji} ${warn.motivo}\n`;
                });
                warnListContent += separator;
            }
        }

        await warnsMessage.edit(warnListContent);
    } catch (error) {
        console.error('Error al actualizar el mensaje de la lista de warns:', error);
    }
}


client.on('ready', async () => {
    console.log(`Hemos iniciado sesión como ${client.user.tag}`);

    try {
        console.log(`Verificando APP_ID para Firestore: ${appId}`);
        const firebaseApp = initializeApp(firebaseConfig);
        db = getFirestore(firebaseApp);
        composCollectionRef = collection(db, `artifacts/${appId}/public/data/compos`);
        warnsCollectionRef = collection(db, `warns`);
        console.log('✅ Firestore inicializado con éxito.');
        
        // Llamada inicial para actualizar la lista de warns al iniciar el bot
        await updateWarnListMessage();

    } catch (error) {
        console.error('ERROR CRÍTICO: No se pudo inicializar Firestore. Las funcionalidades de base de datos no estarán disponibles.', error);
        db = null;
    }

    const commands = [
        new SlashCommandBuilder()
            .setName('start-party')
            .setDescription('Inicia una nueva inscripción de party con un template.')
            .setDefaultMemberPermissions(PermissionFlagsBits.ManageThreads),
        new SlashCommandBuilder()
            .setName('add_compo')
            .setDescription('Añade un nuevo template de party a la base de datos.')
            .setDefaultMemberPermissions(PermissionFlagsBits.ManageThreads),
        new SlashCommandBuilder()
            .setName('remove_user_compo')
            .setDescription('Elimina a un usuario de la party.')
            .addUserOption(option =>
                option.setName('usuario')
                    .setDescription('El usuario a eliminar.')
                    .setRequired(true))
            .setDefaultMemberPermissions(PermissionFlagsBits.ManageThreads),
        new SlashCommandBuilder()
            .setName('add_user_compo')
            .setDescription('Añade un usuario a la party en un puesto específico.')
            .addUserOption(option =>
                option.setName('usuario')
                    .setDescription('El usuario a añadir.')
                    .setRequired(true))
            .addIntegerOption(option =>
                option.setName('puesto')
                    .setDescription('El número del puesto (1-50).')
                    .setRequired(true))
            .setDefaultMemberPermissions(PermissionFlagsBits.ManageThreads),
        new SlashCommandBuilder()
            .setName('delete_comp')
            .setDescription('Elimina un template de party guardado.')
            .setDefaultMemberPermissions(PermissionFlagsBits.ManageThreads),
        new SlashCommandBuilder()
            .setName('edit_comp')
            .setDescription('Edita el mensaje principal de la party.')
            .setDefaultMemberPermissions(PermissionFlagsBits.ManageThreads),
        new SlashCommandBuilder()
            .setName('warn')
            .setDescription('Añade un warn a un usuario.')
            .addUserOption(option =>
                option.setName('usuario')
                    .setDescription('El usuario a advertir.')
                    .setRequired(true))
            .addStringOption(option =>
                option.setName('motivo')
                    .setDescription('El motivo de la advertencia.')
                    .setRequired(true))
            .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers),
        new SlashCommandBuilder()
            .setName('remove-warn')
            .setDescription('Elimina un warn de un usuario.')
            .addUserOption(option =>
                option.setName('usuario')
                    .setDescription('El usuario al que se le va a quitar un warn.')
                    .setRequired(true))
            .addIntegerOption(option =>
                option.setName('numero')
                    .setDescription('El número del warn a eliminar.')
                    .setRequired(true))
            .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers),
    ];

    try {
        await client.application.commands.set(commands);
        console.log('✅ Comandos registrados exitosamente!');
    } catch (error) {
        console.error('Error al registrar comandos:', error);
    }
});

/**
 * Parses the participant list from the main message content.
 * @param {string[]} lineas The lines of the message content.
 * @returns {Map<string, number>} A map of user IDs to their spot number.
 */
function parsearParticipantes(lineas) {
    const participantes = new Map();
    for (const linea of lineas) {
        const match = linea.match(/(\d+)\.(.*?)<@(\d+)>/);
        if (match) {
            const numeroPuesto = parseInt(match[1]);
            const userId = match[3];
            participantes.set(userId, numeroPuesto);
        }
    }
    return participantes;
}

client.on(Events.InteractionCreate, async interaction => {
    try {
        if (interaction.isChatInputCommand()) {
            const { commandName } = interaction;
            
            if (commandName === 'start-party') {
                if (interaction.channel.isThread()) {
                    await interaction.reply({ content: 'Este comando solo se puede usar en un canal de texto normal, no en un hilo.', flags: [MessageFlags.Ephemeral] });
                    return;
                }
                await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

                if (!db) {
                    await interaction.editReply('Error: La base de datos no está disponible. Por favor, inténtalo de nuevo más tarde.');
                    return;
                }

                try {
                    const composSnapshot = await getDocs(composCollectionRef);
                    const options = composSnapshot.docs.map(doc => ({
                        label: doc.data().name,
                        value: doc.id
                    }));

                    if (options.length === 0) {
                        await interaction.editReply('No hay compos de party guardadas. Usa el comando `/add_compo` para añadir una.');
                        return;
                    }

                    const selectMenu = new StringSelectMenuBuilder()
                        .setCustomId('select_compo')
                        .setPlaceholder('Elige un template de party...')
                        .addOptions(options);

                    const row = new ActionRowBuilder().addComponents(selectMenu);
                    await interaction.editReply({ content: 'Por favor, selecciona una compo para iniciar:', components: [row] });
                } catch (error) {
                    console.error('Error al obtener las compos:', error);
                    await interaction.editReply('Hubo un error al cargar los templates de party.');
                }
            } else if (commandName === 'add_compo') {
                const modal = new ModalBuilder()
                    .setCustomId('add_compo_modal')
                    .setTitle('Añadir Nuevo Template de Party');

                const nombreInput = new TextInputBuilder()
                    .setCustomId('compo_name')
                    .setLabel("Nombre de la Compo")
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true)
                    .setPlaceholder('Ej: Party ZvZ, Party HOJ, etc.');

                const mensajeInput = new TextInputBuilder()
                    .setCustomId('compo_content')
                    .setLabel("Mensaje completo de la compo")
                    .setStyle(TextInputStyle.Paragraph)
                    .setRequired(true)
                    .setPlaceholder('Pega aquí el mensaje completo con la lista de roles. Ej: 1. HOJ (caller) : 2. Escarcha/Incubo: ...');

                modal.addComponents(
                    new ActionRowBuilder().addComponents(nombreInput),
                    new ActionRowBuilder().addComponents(mensajeInput)
                );

                await interaction.showModal(modal);
            } else if (commandName === 'remove_user_compo') {
                await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

                if (!interaction.channel.isThread()) {
                    await interaction.editReply('Este comando solo se puede usar dentro de un hilo de party.');
                    return;
                }
                
                const hilo = interaction.channel;
                const mensajePrincipal = await hilo.fetchStarterMessage();

                if (!mensajePrincipal) {
                    await interaction.editReply('No se pudo encontrar el mensaje principal de la party.');
                    return;
                }
                
                const usuarioARemover = interaction.options.getUser('usuario');
                let lineas = mensajePrincipal.content.split('\n');

                const regexUsuario = new RegExp(`<@${usuarioARemover.id}>`);
                let lineaEncontrada = -1;
                for (let i = 0; i < lineas.length; i++) {
                    if (regexUsuario.test(lineas[i])) {
                        lineaEncontrada = i;
                        break;
                    }
                }

                if (lineaEncontrada === -1) {
                    await interaction.editReply(`El usuario <@${usuarioARemover.id}> no se encuentra en la lista de la party.`);
                    return;
                }

                const numeroPuesto = parseInt(lineas[lineaEncontrada].trim().split('.')[0]);
                
                const originalContent = await getOriginalContent(mensajePrincipal.id);
                if (!originalContent) {
                    await interaction.editReply('Error: No se pudo encontrar la plantilla original para restaurar el puesto.');
                    return;
                }

                const originalLines = originalContent.split('\n');
                const originalLineForSpot = originalLines.find(linea => linea.startsWith(`${numeroPuesto}.`));

                if (originalLineForSpot) {
                    const inicioPartyIndex = lineas.findIndex(linea => linea.startsWith('1.'));
                    if (inicioPartyIndex !== -1) {
                        const offset = lineaEncontrada - inicioPartyIndex;
                        lineas[lineaEncontrada] = originalLines[offset];
                    } else {
                        lineas[lineaEncontrada] = originalLineForSpot;
                    }
                } else {
                    lineas[lineaEncontrada] = `${numeroPuesto}. X`;
                }
                
                await mensajePrincipal.edit(lineas.join('\n'));
                await interaction.editReply(`✅ Usuario <@${usuarioARemover.id}> eliminado del puesto **${numeroPuesto}**.`);

            } else if (commandName === 'add_user_compo') {
                await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

                if (!interaction.channel.isThread()) {
                    await interaction.editReply('Este comando solo se puede usar dentro de un hilo de party.');
                    return;
                }

                const hilo = interaction.channel;
                const usuarioAAgregar = interaction.options.getUser('usuario');
                const puestoAAgregar = interaction.options.getInteger('puesto');
                const mensajePrincipal = await hilo.fetchStarterMessage();

                if (!mensajePrincipal) {
                    await interaction.editReply('No se pudo encontrar el mensaje principal de la party.');
                    return;
                }
                
                let lineas = mensajePrincipal.content.split('\n');
                
                const originalContent = await getOriginalContent(mensajePrincipal.id);
                if (!originalContent) {
                    await interaction.editReply('Error: No se pudo encontrar la plantilla original para esta party.');
                    return;
                }
                const originalLines = originalContent.split('\n');

                let oldSpotIndex = -1;
                for (const [index, linea] of lineas.entries()) {
                    if (linea.includes(`<@${usuarioAAgregar.id}>`)) {
                        oldSpotIndex = index;
                        break;
                    }
                }
                
                if (oldSpotIndex !== -1) {
                    const oldLine = lineas[oldSpotIndex];
                    const oldSpot = parseInt(oldLine.trim().split('.')[0]);
                    const originalLineForSpot = originalLines.find(linea => linea.startsWith(`${oldSpot}.`));
                    
                    if (originalLineForSpot) {
                        const inicioPartyIndex = lineas.findIndex(linea => linea.startsWith('1.'));
                        if (inicioPartyIndex !== -1) {
                            const offset = oldSpotIndex - inicioPartyIndex;
                            lineas[oldSpotIndex] = originalLines[offset];
                        } else {
                            lineas[oldSpotIndex] = originalLineForSpot;
                        }
                    } else {
                        const regexClean = new RegExp(`(<@${usuarioAAgregar.id}>)`);
                        lineas[oldSpotIndex] = oldLine.replace(regexClean, '').trim();
                    }
                }

                const lineaNuevaIndex = lineas.findIndex(linea => linea.startsWith(`${puestoAAgregar}.`));
                
                if (lineaNuevaIndex === -1) {
                    await interaction.editReply(`El puesto **${puestoAAgregar}** no es válido.`);
                    return;
                }
                
                if (lineas[lineaNuevaIndex].includes('<@')) {
                    await interaction.editReply(`El puesto **${puestoAAgregar}** ya está ocupado.`);
                    return;
                }
                
                const lineaActual = lineas[lineaNuevaIndex];
                
                let nuevoValor;
                if (lineaActual.includes('. X')) {
                    const preguntaRol = await hilo.send(`<@${interaction.user.id}>, has apuntado a <@${usuarioAAgregar.id}> en el puesto **${puestoAAgregar}**. ¿Qué rol va a ir?`);
                
                    const filtro = m => m.author.id === interaction.user.id;
                    const colector = hilo.createMessageCollector({ filter: filtro, max: 1, time: 60000 });

                    colector.on('collect', async m => {
                        await preguntaRol.delete().catch(() => {});
                        await m.delete().catch(() => {});
                        const rol = m.content;
                        const nuevoValor = `${puestoAAgregar}. ${rol} <@${usuarioAAgregar.id}>`;
                        lineas[lineaNuevaIndex] = nuevoValor;
                        await mensajePrincipal.edit(lineas.join('\n'));
                        await interaction.editReply(`✅ Usuario <@${usuarioAAgregar.id}> añadido al puesto **${puestoAAgregar}** como **${rol}**.`);
                        colector.stop();
                    });

                    colector.on('end', collected => {
                        if (collected.size === 0) {
                            interaction.editReply(`🚫 No respondiste a tiempo. El usuario <@${usuarioAAgregar.id}> no ha sido añadido.`);
                        }
                    });
                } else {
                    nuevoValor = `${lineaActual} <@${usuarioAAgregar.id}>`;
                    lineas[lineaNuevaIndex] = nuevoValor;
                    await mensajePrincipal.edit(lineas.join('\n'));
                    await interaction.editReply(`✅ Usuario <@${usuarioAAgregar.id}> añadido al puesto **${puestoAAgregar}**.`);
                }
            } else if (commandName === 'delete_comp') {
                await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

                if (!db) {
                    await interaction.editReply('Error: La base de datos no está disponible. Por favor, inténtalo de nuevo más tarde.');
                    return;
                }

                try {
                    const composSnapshot = await getDocs(composCollectionRef);
                    const options = composSnapshot.docs.map(doc => ({
                        label: doc.data().name,
                        value: doc.id
                    }));

                    if (options.length === 0) {
                        await interaction.editReply('No hay compos de party guardadas para eliminar.');
                        return;
                    }

                    const selectMenu = new StringSelectMenuBuilder()
                        .setCustomId('delete_compo_select')
                        .setPlaceholder('Elige un template de party para eliminar...')
                        .addOptions(options);
                    
                    const row = new ActionRowBuilder().addComponents(selectMenu);
                    await interaction.editReply({ content: 'Por favor, selecciona la compo que deseas eliminar:', components: [row] });

                } catch (error) {
                    console.error('Error al obtener compos para eliminar:', error);
                    await interaction.editReply('Hubo un error al cargar los templates de party para eliminar.');
                }
            } else if (commandName === 'edit_comp') {
                if (!interaction.channel.isThread()) {
                    await interaction.reply({ content: 'Este comando solo se puede usar dentro de un hilo de party.', flags: [MessageFlags.Ephemeral] });
                    return;
                }
                
                const hilo = interaction.channel;
                if (hilo.locked) {
                    await interaction.reply({ content: '❌ Las inscripciones han finalizado. No se puede editar el mensaje.', flags: [MessageFlags.Ephemeral] });
                    return;
                }

                const mensajePrincipal = await hilo.fetchStarterMessage();
                if (!mensajePrincipal) {
                    await interaction.reply({ content: 'No se pudo encontrar el mensaje principal de la party.', flags: [MessageFlags.Ephemeral] });
                    return;
                }

                const selectMenu = new StringSelectMenuBuilder()
                    .setCustomId(`edit_comp_select_${mensajePrincipal.id}`)
                    .setPlaceholder('¿Qué parte del mensaje quieres editar?')
                    .addOptions([
                        { label: 'Hora del Masse o evento', value: 'hora' },
                        { label: 'Mensaje de Encabezado', value: 'encabezado' },
                    ]);

                const row = new ActionRowBuilder().addComponents(selectMenu);
                await interaction.reply({ content: 'Selecciona lo que quieres editar:', components: [row], flags: [MessageFlags.Ephemeral] });
            } else if (commandName === 'warn') {
                await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

                if (!db) {
                    return interaction.editReply('Error: La base de datos no está disponible.');
                }

                const usuario = interaction.options.getUser('usuario');
                const motivo = interaction.options.getString('motivo');
                const author = interaction.user;

                try {
                    await addDoc(collection(db, 'warns', usuario.id, 'list'), {
                        motivo: motivo,
                        fecha: new Date().toISOString(),
                        moderador: author.id
                    });
                    await updateWarnListMessage();
                    await interaction.editReply(`✅ Warn añadido a <@${usuario.id}> por el motivo: "${motivo}"`);
                } catch (error) {
                    console.error('Error al añadir warn:', error);
                    await interaction.editReply('Hubo un error al añadir el warn. Por favor, inténtalo de nuevo.');
                }
            } else if (commandName === 'remove-warn') {
                await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

                if (!db) {
                    return interaction.editReply('Error: La base de datos no está disponible.');
                }

                const usuario = interaction.options.getUser('usuario');
                const numeroWarn = interaction.options.getInteger('numero');

                try {
                    const userWarnsQuery = await getDocs(collection(db, 'warns', usuario.id, 'list'));
                    const warns = userWarnsQuery.docs.map(doc => ({ id: doc.id, ...doc.data() }));

                    if (numeroWarn > warns.length || numeroWarn <= 0) {
                        return interaction.editReply(`❌ No existe un warn con el número **${numeroWarn}** para <@${usuario.id}>.`);
                    }

                    const warnToDelete = warns[numeroWarn - 1];
                    const warnRef = doc(db, 'warns', usuario.id, 'list', warnToDelete.id);
                    await deleteDoc(warnRef);

                    await updateWarnListMessage();

                    await interaction.editReply(`✅ Warn número **${numeroWarn}** eliminado de <@${usuario.id}>.`);
                } catch (error) {
                    console.error('Error al eliminar warn:', error);
                    await interaction.editReply('Hubo un error al eliminar el warn. Por favor, inténtalo de nuevo.');
                }
            }
        } else if (interaction.isStringSelectMenu()) {
            if (interaction.customId === 'select_compo') {
                if (!db) {
                    await interaction.reply({ content: 'Error: La base de datos no está disponible. Por favor, inténtalo de nuevo más tarde.', flags: [MessageFlags.Ephemeral] });
                    return;
                }
                
                try {
                    const compoId = interaction.values[0];
                    const docRef = doc(db, `artifacts/${appId}/public/data/compos`, compoId);
                    const selectedCompo = await getDoc(docRef);

                    if (!selectedCompo.exists()) {
                        await interaction.reply({ content: 'Error: El template de party no fue encontrado.', flags: [MessageFlags.Ephemeral] });
                        return;
                    }
                    const compoName = selectedCompo.data().name;

                    const modal = new ModalBuilder()
                        .setCustomId(`start_comp_modal_${compoId}`)
                        .setTitle(`Iniciar Party con: ${compoName}`);

                    const horaMasseoInput = new TextInputBuilder()
                        .setCustomId('hora_masseo')
                        .setLabel("Hora del masseo?")
                        .setStyle(TextInputStyle.Short)
                        .setRequired(true)
                        .setPlaceholder('Ej: 22:00 UTC');

                    const tiempoFinalizacionInput = new TextInputBuilder()
                        .setCustomId('tiempo_finalizacion')
                        .setLabel("En cuánto tiempo finalizan las inscripciones?")
                        .setStyle(TextInputStyle.Short)
                        .setRequired(true)
                        .setPlaceholder('Ej: 2h 30m');

                    const mensajeEncabezadoInput = new TextInputBuilder()
                        .setCustomId('mensaje_encabezado')
                        .setLabel("Mensaje de encabezado?")
                        .setStyle(TextInputStyle.Paragraph)
                        .setRequired(false)
                        .setPlaceholder('Ej: DESDE HOY 1+2+3+4 SET...');

                    modal.addComponents(
                        new ActionRowBuilder().addComponents(horaMasseoInput),
                        new ActionRowBuilder().addComponents(tiempoFinalizacionInput),
                        new ActionRowBuilder().addComponents(mensajeEncabezadoInput)
                    );
                    
                    await interaction.showModal(modal);
                } catch (error) {
                    console.error('Error al obtener las compos:', error);
                    if (!interaction.replied) {
                        await interaction.reply({ content: 'Hubo un error al cargar los templates de party.', flags: [MessageFlags.Ephemeral] });
                    }
                }
            } else if (interaction.customId === 'delete_compo_select') {
                await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

                if (!db) {
                    await interaction.editReply('Error: La base de datos no está disponible. Por favor, inténtalo de nuevo más tarde.');
                    return;
                }

                const compoId = interaction.values[0];

                try {
                    await deleteDoc(doc(db, `artifacts/${appId}/public/data/compos`, compoId));
                    await interaction.editReply(`✅ El template de party se ha eliminado correctamente.`);
                } catch (error) {
                    console.error('Error al eliminar el template de party:', error);
                    await interaction.editReply('Hubo un error al eliminar el template. Por favor, inténtalo de nuevo.');
                }
            } else if (interaction.customId.startsWith('edit_comp_select_')) {
                const mensajePrincipalId = interaction.customId.split('_')[3];
                const campoAEditar = interaction.values[0];

                const modal = new ModalBuilder()
                    .setCustomId(`edit_comp_modal_${mensajePrincipalId}_${campoAEditar}`)
                    .setTitle(`Editar ${campoAEditar}`);

                const valorActual = interaction.message.content;
                let valorInput;

                if (campoAEditar === 'hora') {
                    const matchHora = valorActual.match(/^(.*?)\n/);
                    const valor = matchHora ? matchHora[1] : '';
                    valorInput = new TextInputBuilder()
                        .setCustomId('nuevo_valor')
                        .setLabel('Nueva hora del masseo')
                        .setStyle(TextInputStyle.Short)
                        .setRequired(true)
                        .setValue(valor);
                } else if (campoAEditar === 'encabezado') {
                    const matchHeader = valorActual.match(/\n(.*?)\n\n/s);
                    const valor = matchHeader ? matchHeader[1] : '';
                    valorInput = new TextInputBuilder()
                        .setCustomId('nuevo_valor')
                        .setLabel('Nuevo mensaje de encabezado')
                        .setStyle(TextInputStyle.Paragraph)
                        .setRequired(false)
                        .setValue(valor);
                }
                
                modal.addComponents(new ActionRowBuilder().addComponents(valorInput));
                await interaction.showModal(modal);
            }
        } else if (interaction.isButton()) {
            if (interaction.customId === 'desapuntarme_button') {
                await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

                const message = interaction.message;
                const user = interaction.user;

                if (!message.channel.isThread()) {
                    await interaction.editReply('Este botón solo funciona en un hilo de party.');
                    return;
                }

                const mensajePrincipal = await message.channel.fetchStarterMessage().catch(() => null);
                if (!mensajePrincipal) {
                    await interaction.editReply('No se pudo encontrar el mensaje principal de la party. Inténtalo de nuevo.');
                    return;
                }
                
                try {
                    let lineas = mensajePrincipal.content.split('\n');
                    let oldSpotIndex = -1;
                    let oldSpot = -1;

                    for (const [index, linea] of lineas.entries()) {
                        if (linea.includes(`<@${user.id}>`)) {
                            oldSpotIndex = index;
                            oldSpot = parseInt(linea.trim().split('.')[0]);
                            break;
                        }
                    }
                    
                    if (oldSpotIndex === -1) {
                        await interaction.editReply('No estás apuntado en esta party.');
                        return;
                    }
                    
                    const originalContent = await getOriginalContent(mensajePrincipal.id);
                    if (!originalContent) {
                        await interaction.editReply('Error: No se pudo encontrar la plantilla original para restaurar el puesto.');
                        return;
                    }

                    const originalLines = originalContent.split('\n');
                    const originalLineForSpot = originalLines.find(linea => linea.startsWith(`${oldSpot}.`));

                    if (originalLineForSpot) {
                        lineas[oldSpotIndex] = originalLineForSpot;
                    } else {
                        const regexClean = new RegExp(`(<@${user.id}>)`);
                        lineas[oldSpotIndex] = lineas[oldSpotIndex].replace(regexClean, '').trim();
                    }

                    await mensajePrincipal.edit({ content: lineas.join('\n') });
                    await interaction.editReply(`✅ Te has desapuntado del puesto **${oldSpot}**.`);
                } catch (error) {
                    console.error('Error procesando el botón de desapuntar:', error);
                    await interaction.editReply('Hubo un error al intentar desapuntarte. Por favor, inténtalo de nuevo.');
                }
            }
        } else if (interaction.type === InteractionType.ModalSubmit) {
            if (interaction.customId === 'add_compo_modal') {
                const compoName = interaction.fields.getTextInputValue('compo_name');
                const compoContent = interaction.fields.getTextInputValue('compo_content');
                
                if (!db) {
                    await interaction.reply({ content: 'Error: La base de datos no está disponible.', flags: [MessageFlags.Ephemeral] });
                    return;
                }

                try {
                    await addDoc(composCollectionRef, {
                        name: compoName,
                        content: compoContent
                    });
                    await interaction.reply({ content: `✅ El template de party **${compoName}** ha sido guardado.`, flags: [MessageFlags.Ephemeral] });
                } catch (error) {
                    console.error('Error al guardar el template de party:', error);
                    await interaction.reply({ content: 'Hubo un error al guardar el template.', flags: [MessageFlags.Ephemeral] });
                }
                return;
            }

            if (interaction.customId.startsWith('start_comp_modal_')) {
                await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

                const compoId = interaction.customId.split('_')[3];

                if (!db) {
                    await interaction.editReply('Error: La base de datos no está disponible.');
                    return;
                }

                try {
                    const docRef = doc(db, `artifacts/${appId}/public/data/compos`, compoId);
                    const selectedCompo = await getDoc(docRef);

                    if (!selectedCompo.exists()) {
                        await interaction.editReply('Error: El template de party no fue encontrado.');
                        return;
                    }
                    const compoContent = selectedCompo.data().content;
                    const compoName = selectedCompo.data().name;

                    const horaMasseo = interaction.fields.getTextInputValue('hora_masseo');
                    const tiempoFinalizacionStr = interaction.fields.getTextInputValue('tiempo_finalizacion');
                    const mensajeEncabezado = interaction.fields.getTextInputValue('mensaje_encabezado');

                    let totalMilisegundos = 0;
                    const regexHoras = /(\d+)\s*h/;
                    const regexMinutos = /(\d+)\s*m/;

                    const matchHoras = tiempoFinalizacionStr.match(regexHoras);
                    const matchMinutos = tiempoFinalizacionStr.match(regexMinutos);

                    if (matchHoras) {
                        totalMilisegundos += parseInt(matchHoras[1]) * 60 * 60 * 1000;
                    }
                    if (matchMinutos) {
                        totalMilisegundos += parseInt(matchMinutos[1]) * 60 * 1000;
                    }

                    const fechaFinalizacion = Math.floor((Date.now() + totalMilisegundos) / 1000);

                    const mensajeCompleto = `${horaMasseo}
${mensajeEncabezado || ''}

**INSCRIPCIONES TERMINAN:** <t:${fechaFinalizacion}:R>

${compoContent}`;

                    const desapuntarmeButton = new ButtonBuilder()
                        .setCustomId('desapuntarme_button')
                        .setLabel('❌ Desapuntarme')
                        .setStyle(ButtonStyle.Danger);

                    const buttonRow = new ActionRowBuilder().addComponents(desapuntarmeButton);

                    const mensajePrincipal = await interaction.channel.send({ content: mensajeCompleto });
                    
                    if (db) {
                        try {
                            const docRef = doc(db, 'live_parties', mensajePrincipal.id);
                            await setDoc(docRef, {
                                originalContent: compoContent,
                                threadId: mensajePrincipal.channel.id
                            });
                        } catch (error) {
                            console.error('Error al guardar la plantilla en Firebase:', error);
                        }
                    }
                    originalCompoContent.set(mensajePrincipal.id, compoContent);

                    const hilo = await mensajePrincipal.startThread({
                        name: "Inscripción de la party",
                        autoArchiveDuration: 60,
                    });
                    
                    await hilo.send({ content: "¡Escribe un número para apuntarte!", components: [buttonRow] });

                    if (totalMilisegundos > 0) {
                        await hilo.send(`El hilo se bloqueará automáticamente en **${tiempoFinalizacionStr}**.`);
                        
                        setTimeout(async () => {
                            try {
                                const canalHilo = await client.channels.fetch(hilo.id);
                                if (canalHilo && !canalHilo.archived && !canalHilo.locked) {
                                    await canalHilo.setLocked(true);
                                    await canalHilo.send('¡Las inscripciones han terminado! Este hilo ha sido bloqueado y ya no se pueden añadir más participantes.');
                                    
                                    if (db) {
                                        try {
                                            await deleteDoc(doc(db, 'live_parties', mensajePrincipal.id));
                                        } catch (error) {
                                            console.error('Error al eliminar la plantilla de Firebase:', error);
                                        }
                                    }
                                } else {
                                    console.log(`El hilo ${hilo.id} ya no existe, está archivado o ya está bloqueado. No se puede bloquear.`);
                                }
                            } catch (error) {
                                console.error(`Error al bloquear el hilo ${hilo.id}:`, error);
                            }
                        }, totalMilisegundos);
                    }

                    await interaction.editReply({ content: `✅ La party se ha iniciado correctamente. Puedes verla en <#${hilo.id}>.`, flags: [MessageFlags.Ephemeral] });

                } catch (error) {
                    console.error('Error al crear la party o el hilo:', error);
                    await interaction.editReply({ content: 'Hubo un error al intentar crear la party. Por favor, asegúrate de que el bot tenga los permisos necesarios.', flags: [MessageFlags.Ephemeral] });
                }
            } else if (interaction.customId.startsWith('edit_comp_modal_')) {
                await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

                const partes = interaction.customId.split('_');
                const mensajePrincipalId = partes[3];
                const campoAEditar = partes[4];
                const nuevoValor = interaction.fields.getTextInputValue('nuevo_valor');

                try {
                    const mensajePrincipal = await interaction.channel.messages.fetch(mensajePrincipalId);
                    if (!mensajePrincipal) {
                        await interaction.editReply('No se pudo encontrar el mensaje a editar.');
                        return;
                    }
                    
                    let lineas = mensajePrincipal.content.split('\n');
                    
                    if (campoAEditar === 'hora') {
                        lineas[0] = nuevoValor;
                    } else if (campoAEditar === 'encabezado') {
                        const finalHoraIndex = 0;
                        const inicioInscripcionesIndex = lineas.findIndex(linea => linea.startsWith('**INSCRIPCIONES TERMINAN:**'));

                        if (inicioInscripcionesIndex > finalHoraIndex + 1) {
                            lineas.splice(finalHoraIndex + 1, inicioInscripcionesIndex - (finalHoraIndex + 1), nuevoValor);
                        } else if (nuevoValor) {
                            lineas.splice(finalHoraIndex + 1, 0, nuevoValor);
                        }
                    }
                    
                    await mensajePrincipal.edit(lineas.join('\n'));
                    await interaction.editReply(`✅ Se ha actualizado la **${campoAEditar}** del mensaje principal.`);
                } catch (error) {
                    console.error('Error al editar el mensaje de la compo:', error);
                    await interaction.editReply('Hubo un error al intentar editar el mensaje.');
                }
            }
        }
    } catch (error) {
        console.error('Error no controlado en InteractionCreate:', error);
        if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
            await interaction.reply({ content: 'Ocurrió un error inesperado. Por favor, inténtalo de nuevo.', flags: [MessageFlags.Ephemeral] }).catch(() => {});
        }
    }
});

client.on(Events.MessageCreate, async message => {
    if (message.author.bot || !message.channel.isThread()) {
        return;
    }
    
    const { channel, author, content } = message;
    const numero = parseInt(content.trim());
    
    if (channel.locked) {
        if (content.trim().toLowerCase() !== 'desapuntar' && !isNaN(numero)) {
            await message.delete().catch(() => {});
            const mensajeError = await channel.send(`❌ <@${author.id}>, las inscripciones han finalizado. Este hilo está bloqueado.`);
            setTimeout(() => mensajeError.delete().catch(() => {}), 10000);
            return;
        }
    }
    
    if (content.trim().toLowerCase() === 'desapuntar') {
        const mensajePrincipal = await channel.fetchStarterMessage().catch(() => null);
        if (!mensajePrincipal) {
            await message.delete().catch(() => {});
            await channel.send('Lo sentimos, no hemos podido cargar el primer mensaje de este hilo. Por favor, intenta crear una nueva party.').then(m => setTimeout(() => m.delete().catch(() => {}), 10000));
            return;
        }

        try {
            let lineas = mensajePrincipal.content.split('\n');
            let oldSpotIndex = -1;
            let oldSpot = -1;

            for (const [index, linea] of lineas.entries()) {
                if (linea.includes(`<@${author.id}>`)) {
                    oldSpotIndex = index;
                    oldSpot = parseInt(linea.trim().split('.')[0]);
                    break;
                }
            }
            
            if (oldSpotIndex === -1) {
                await message.delete().catch(() => {});
                const mensajeError = await channel.send(`❌ <@${author.id}>, no estás apuntado en esta party.`);
                setTimeout(() => mensajeError.delete().catch(() => {}), 10000);
                return;
            }
            
            const originalContent = await getOriginalContent(mensajePrincipal.id);
            if (!originalContent) {
                await message.delete().catch(() => {});
                const mensajeError = await channel.send('Error: No se pudo encontrar la plantilla original para restaurar el puesto.');
                setTimeout(() => mensajeError.delete().catch(() => {}), 10000);
                return;
            }

            const originalLines = originalContent.split('\n');
            const originalLineForSpot = originalLines.find(linea => linea.startsWith(`${oldSpot}.`));

            if (originalLineForSpot) {
                lineas[oldSpotIndex] = originalLineForSpot;
            } else {
                const regexClean = new RegExp(`(<@${author.id}>)`);
                lineas[oldSpotIndex] = lineas[oldSpotIndex].replace(regexClean, '').trim();
            }

            await mensajePrincipal.edit({ content: lineas.join('\n') });
            await message.delete().catch(() => {});

            const mensajeConfirmacion = await channel.send(`✅ <@${author.id}>, te has desapuntado del puesto **${oldSpot}**.`);
            setTimeout(() => mensajeConfirmacion.delete().catch(() => {}), 10000);
            return;
        } catch (error) {
            console.error('Error procesando mensaje para desapuntar:', error);
            await message.delete().catch(() => {});
            channel.send(`Hubo un error al procesar tu solicitud, <@${author.id}>. Por favor, inténtalo de nuevo.`).then(m => setTimeout(() => m.delete().catch(() => {}), 10000));
            return;
        }
    }
    
    if (isNaN(numero) || numero < 1 || numero > 50) {
        return;
    }

    try {
        await message.delete();

        const mensajePrincipal = await channel.fetchStarterMessage();
        if (!mensajePrincipal) {
            return;
        }

        let lineas = mensajePrincipal.content.split('\n');
        
        let oldSpotIndex = -1;
        for (const [index, linea] of lineas.entries()) {
            const regex = new RegExp(`<@${author.id}>`);
            if (regex.test(linea)) {
                oldSpotIndex = index;
                break;
            }
        }

        if (oldSpotIndex !== -1) {
            const oldLine = lineas[oldSpotIndex];
            const oldSpot = parseInt(oldLine.trim().split('.')[0]);
            
            const originalContent = await getOriginalContent(mensajePrincipal.id);
            if (originalContent) {
                const originalLines = originalContent.split('\n');
                const originalLineForSpot = originalLines.find(linea => linea.startsWith(`${oldSpot}.`));
                if (originalLineForSpot) {
                    lineas[oldSpotIndex] = originalLineForSpot;
                }
            } else {
                const regexUser = new RegExp(`(<@${author.id}>)`);
                const remainingContent = oldLine.replace(regexUser, '').trim();

                if (oldSpot >= 35) {
                    lineas[oldSpotIndex] = `${oldSpot}. X`;
                } else {
                    const rolMatch = remainingContent.match(/(\d+\.\s*)(.*)/);
                    if (rolMatch) {
                        lineas[oldSpotIndex] = `${rolMatch[1]}${rolMatch[2]}`;
                    } else {
                        lineas[oldSpotIndex] = `${oldSpot}.`;
                    }
                }
            }
        }
    
        const indiceLinea = lineas.findIndex(linea => linea.startsWith(`${numero}.`));
    
        if (indiceLinea !== -1) {
            if (lineas[indiceLinea].includes('<@')) {
                const mensajeOcupado = await channel.send(`<@${author.id}>, el puesto **${numero}** ya está ocupado.`);
                setTimeout(() => mensajeOcupado.delete().catch(() => {}), 10000);
                return;
            }
            
            const lineaActual = lineas[indiceLinea];
            let nuevoValor = `${lineaActual} <@${author.id}>`;
            lineas[indiceLinea] = nuevoValor;

            await mensajePrincipal.edit(lineas.join('\n'));
            const mensajeConfirmacion = await channel.send(`✅ <@${author.id}>, te has apuntado en el puesto **${numero}**.`);
            setTimeout(() => mensajeConfirmacion.delete().catch(() => {}), 10000);
        } else {
            const mensajeInvalido = await channel.send(`<@${author.id}>, el número **${numero}** no es un puesto válido.`);
            setTimeout(() => mensajeInvalido.delete().catch(() => {}), 10000);
        }
    } catch (error) {
        console.error('Error procesando mensaje de inscripción:', error);
        channel.send(`Hubo un error al procesar tu solicitud, <@${author.id}>. Por favor, inténtalo de nuevo.`).then(m => setTimeout(() => m.delete().catch(() => {}), 10000));
    }
});

client.login(process.env.DISCORD_TOKEN).catch(error => {
    console.error("EL LOGIN HA FALLADO. Error recibido:", error.message);
});
