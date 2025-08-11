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
let warnsChannelId = 'REEMPLAZAR_CON_ID_DEL_CANAL_DE_WARNS'; // Reemplaza con el ID de tu canal de warns
let warnsMessageId = 'REEMPLAZAR_CON_ID_DEL_MENSAJE_DE_WARNS'; // Reemplaza con el ID del mensaje inicial

const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';

// === CONFIGURACIÓN DE FIRESTORE: AÑADE TU OBJETO AQUÍ ===
const firebaseConfig = {
    apiKey: "AIzaSyCaPKwXut-_NA0se1WPgpNltWNWU1RSVgQ",
    authDomain: "just-run-af870.firebaseapp.com",
    projectId: "just-run-af870",
    storageBucket: "just-run-af870.firebasestorage.app",
    messagingSenderId: "834384222332",
    appId: "1:834384222332:web:ed7bbb45baf0e80b2711f9",
    measurementId: "G-8YF78WQ4BQ"
};
// =======================================================

// Ya no usamos un Map en memoria. El estado se gestionará en Firebase.

async function getOriginalContent(messageId) {
    if (!db) {
        console.error('Error: Se intentó llamar a getOriginalContent sin conexión a la base de datos.');
        return null;
    }
    try {
        const docRef = doc(db, 'live_parties', messageId);
        const docSnap = await getDoc(docRef);

        if (docSnap.exists()) {
            return docSnap.data().originalContent;
        } else {
            console.log(`No se encontró documento en 'live_parties' para el ID: ${messageId}`);
            return null;
        }
    } catch (error) {
        console.error(`Error al recuperar la plantilla de Firebase para el ID ${messageId}:`, error);
        return null;
    }
}

// Función para actualizar el mensaje de la lista de warns
async function updateWarnListMessage(guild) {
    if (!db || !warnsChannelId || !warnsMessageId) {
        console.error('Falta la configuración de Firebase o del canal/mensaje de warns. No se puede actualizar la lista.');
        return;
    }
    
    try {
        const warnsChannel = await guild.channels.fetch(warnsChannelId);
        if (!warnsChannel) {
            console.error('No se pudo encontrar el canal de warns.');
            return;
        }

        const warnsMessage = await warnsChannel.messages.fetch(warnsMessageId);
        if (!warnsMessage) {
            console.error('No se pudo encontrar el mensaje de warns.');
            return;
        }

        const allWarnedUsersQuery = await getDocs(collection(db, 'warns'));
        const allWarnedUsers = await Promise.all(allWarnedUsersQuery.docs.map(async doc => {
            const userId = doc.id;
            const userWarnsQuery = await getDocs(collection(db, 'warns', userId, 'list'));
            const warnsCount = userWarnsQuery.size;
            return { userId, warnsCount };
        }));

        const validWarnedUsers = allWarnedUsers.filter(u => u.warnsCount > 0);

        let warnListContent = `***__WARN LIST__***\n\n`;

        for (const userEntry of validWarnedUsers) {
            const userWarnsQuery = await getDocs(collection(db, 'warns', userEntry.userId, 'list'));
            const warns = userWarnsQuery.docs.map(doc => doc.data());
            
            warnListContent += `**<@${userEntry.userId}>** **${warns.length}/3**\n`;
            
            warns.forEach((warn, index) => {
                warnListContent += `${index + 1}. - ${warn.motivo}\n`;
            });
            warnListContent += '\n';
        }

        if (validWarnedUsers.length === 0) {
            warnListContent += 'No hay usuarios con warns actualmente.';
        }

        await warnsMessage.edit(warnListContent);
    } catch (error) {
        console.error('Error al actualizar el mensaje de la lista de warns:', error);
    }
}


client.on('ready', async () => {
    console.log(`Hemos iniciado sesión como ${client.user.tag}`);

    try {
        const firebaseApp = initializeApp(firebaseConfig);
        db = getFirestore(firebaseApp);
        composCollectionRef = collection(db, `artifacts/${appId}/public/data/compos`);
        warnsCollectionRef = collection(db, `warns`);
        console.log('✅ Firestore inicializado con éxito.');
    } catch (error) {
        console.error('ERROR CRÍTICO: No se pudo inicializar Firestore. Las funcionalidades de base de datos no estarán disponibles.', error);
        db = null;
    }

    const commands = [
        new SlashCommandBuilder()
            .setName('start_comp')
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
        new SlashCommandBuilder()
            .setName('warn-list')
            .setDescription('Muestra la lista de warns de un usuario.')
            .addUserOption(option =>
                option.setName('usuario')
                    .setDescription('El usuario para ver sus warns.')
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

// Esta función ya no es necesaria con la lógica actual
// function parsearParticipantes(lineas) { ... }


client.on(Events.InteractionCreate, async interaction => {
    try {
        if (interaction.isChatInputCommand()) {
            const { commandName } = interaction;
            
            if (commandName === 'start_comp') {
                if (interaction.channel.isThread()) {
                    return interaction.reply({ content: 'Este comando solo se puede usar en un canal de texto normal, no en un hilo.', flags: [MessageFlags.Ephemeral] });
                }
                await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

                if (!db) return interaction.editReply('Error: La base de datos no está disponible.');

                try {
                    const composSnapshot = await getDocs(composCollectionRef);
                    const options = composSnapshot.docs.map(doc => ({
                        label: doc.data().name,
                        value: doc.id
                    }));
                    if (options.length === 0) return interaction.editReply('No hay compos de party guardadas. Usa `/add_compo`.');
                    
                    const selectMenu = new StringSelectMenuBuilder().setCustomId('select_compo').setPlaceholder('Elige un template...').addOptions(options);
                    const row = new ActionRowBuilder().addComponents(selectMenu);
                    await interaction.editReply({ content: 'Por favor, selecciona una compo para iniciar:', components: [row] });
                } catch (error) {
                    console.error('Error al obtener las compos:', error);
                    await interaction.editReply('Hubo un error al cargar los templates.');
                }
            } else if (commandName === 'add_compo') {
                const modal = new ModalBuilder().setCustomId('add_compo_modal').setTitle('Añadir Nuevo Template de Party');
                const nombreInput = new TextInputBuilder().setCustomId('compo_name').setLabel("Nombre de la Compo").setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder('Ej: Party ZvZ');
                const mensajeInput = new TextInputBuilder().setCustomId('compo_content').setLabel("Mensaje completo de la compo").setStyle(TextInputStyle.Paragraph).setRequired(true).setPlaceholder('Pega aquí el mensaje completo...');
                modal.addComponents(new ActionRowBuilder().addComponents(nombreInput), new ActionRowBuilder().addComponents(mensajeInput));
                await interaction.showModal(modal);
            } else if (commandName === 'remove_user_compo' || commandName === 'add_user_compo') {
                await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
            
                if (!interaction.channel.isThread()) {
                    return interaction.editReply('Este comando solo se puede usar dentro de un hilo de party.');
                }
            
                const hilo = interaction.channel;
                const mensajePrincipal = await hilo.fetchStarterMessage().catch(() => null);
            
                if (!mensajePrincipal) {
                    return interaction.editReply('No se pudo encontrar el mensaje principal de la party.');
                }
            
                const usuario = interaction.options.getUser('usuario');
                let lineas = mensajePrincipal.content.split('\n');
                const originalContent = await getOriginalContent(mensajePrincipal.id);
            
                if (!originalContent) {
                    return interaction.editReply('Error: No se pudo encontrar la plantilla original para esta party. No se puede modificar.');
                }
                const originalLines = originalContent.split('\n');
            
                // Limpiar puesto antiguo del usuario si ya estaba apuntado
                const oldSpotIndex = lineas.findIndex(line => line.includes(`<@${usuario.id}>`));
                if (oldSpotIndex !== -1) {
                    const oldSpotNumberMatch = lineas[oldSpotIndex].match(/^(\d+)\./);
                    if (oldSpotNumberMatch) {
                        const oldSpotNumber = oldSpotNumberMatch[1];
                        const originalLineForOldSpot = originalLines.find(line => line.startsWith(`${oldSpotNumber}.`));
                        if (originalLineForOldSpot) {
                            lineas[oldSpotIndex] = originalLineForOldSpot;
                        } else {
                            // Fallback por si la plantilla no coincide, aunque no debería pasar
                            lineas[oldSpotIndex] = `${oldSpotNumber}. X`;
                        }
                    }
                }
            
                if (commandName === 'remove_user_compo') {
                    if (oldSpotIndex === -1) {
                        return interaction.editReply(`El usuario <@${usuario.id}> no se encuentra en la lista.`);
                    }
                    await mensajePrincipal.edit(lineas.join('\n'));
                    return interaction.editReply(`✅ Usuario <@${usuario.id}> eliminado correctamente.`);
                }
            
                if (commandName === 'add_user_compo') {
                    const puesto = interaction.options.getInteger('puesto');
                    const newSpotIndex = lineas.findIndex(line => line.startsWith(`${puesto}.`));
            
                    if (newSpotIndex === -1) {
                        return interaction.editReply(`El puesto **${puesto}** no es válido.`);
                    }
            
                    if (lineas[newSpotIndex].includes('<@')) {
                        // Restaura el estado anterior si fallamos
                        await mensajePrincipal.edit(mensajePrincipal.content);
                        return interaction.editReply(`El puesto **${puesto}** ya está ocupado.`);
                    }
            
                    const lineaActual = lineas[newSpotIndex];
                    if (lineaActual.includes('. X')) {
                        const preguntaRol = await hilo.send(`<@${interaction.user.id}>, has apuntado a <@${usuario.id}> en el puesto **${puesto}**. ¿Qué rol va a ir?`);
                        const filtro = m => m.author.id === interaction.user.id;
                        const colector = hilo.createMessageCollector({ filter: filtro, max: 1, time: 60000 });
            
                        colector.on('collect', async m => {
                            await preguntaRol.delete().catch(() => {});
                            await m.delete().catch(() => {});
                            const rol = m.content;
                            lineas[newSpotIndex] = `${puesto}. ${rol} <@${usuario.id}>`;
                            await mensajePrincipal.edit(lineas.join('\n'));
                            await interaction.editReply(`✅ Usuario <@${usuario.id}> añadido al puesto **${puesto}** como **${rol}**.`);
                        });
            
                        colector.on('end', async collected => {
                            if (collected.size === 0) {
                                await preguntaRol.delete().catch(() => {});
                                await interaction.editReply(`🚫 No respondiste a tiempo. El usuario no ha sido añadido.`);
                                // Restaura el estado anterior si no hubo respuesta
                                await mensajePrincipal.edit(mensajePrincipal.content); 
                            }
                        });
                    } else {
                        lineas[newSpotIndex] = `${lineaActual} <@${usuario.id}>`;
                        await mensajePrincipal.edit(lineas.join('\n'));
                        await interaction.editReply(`✅ Usuario <@${usuario.id}> añadido al puesto **${puesto}**.`);
                    }
                }
            } else if (commandName === 'delete_comp') {
                 await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

                if (!db) return interaction.editReply('Error: La base de datos no está disponible.');

                const composSnapshot = await getDocs(composCollectionRef);
                const options = composSnapshot.docs.map(doc => ({ label: doc.data().name, value: doc.id }));

                if (options.length === 0) return interaction.editReply('No hay compos guardadas para eliminar.');

                const selectMenu = new StringSelectMenuBuilder().setCustomId('delete_compo_select').setPlaceholder('Elige un template para eliminar...').addOptions(options);
                const row = new ActionRowBuilder().addComponents(selectMenu);
                await interaction.editReply({ content: 'Selecciona la compo a eliminar:', components: [row] });
            }
            // ... (resto de los comandos de chat como 'edit_comp', 'warn', etc. que no se ven afectados por este cambio)
        } else if (interaction.isStringSelectMenu()) {
            if (interaction.customId === 'select_compo') {
                 if (!db) return interaction.reply({ content: 'Error: La base de datos no está disponible.', flags: [MessageFlags.Ephemeral] });
                
                const compoId = interaction.values[0];
                const docRef = doc(db, `artifacts/${appId}/public/data/compos`, compoId);
                const selectedCompo = await getDoc(docRef);

                if (!selectedCompo.exists()) return interaction.reply({ content: 'Error: El template no fue encontrado.', flags: [MessageFlags.Ephemeral] });
                
                const compoName = selectedCompo.data().name;
                const modal = new ModalBuilder().setCustomId(`start_comp_modal_${compoId}`).setTitle(`Iniciar Party con: ${compoName}`);
                const horaMasseoInput = new TextInputBuilder().setCustomId('hora_masseo').setLabel("Hora del masseo?").setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder('Ej: 22:00 UTC');
                const tiempoFinalizacionInput = new TextInputBuilder().setCustomId('tiempo_finalizacion').setLabel("En cuánto tiempo finalizan inscripciones?").setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder('Ej: 2h 30m');
                const mensajeEncabezadoInput = new TextInputBuilder().setCustomId('mensaje_encabezado').setLabel("Mensaje de encabezado?").setStyle(TextInputStyle.Paragraph).setRequired(false).setPlaceholder('Opcional...');
                modal.addComponents(new ActionRowBuilder().addComponents(horaMasseoInput), new ActionRowBuilder().addComponents(tiempoFinalizacionInput), new ActionRowRowBuilder().addComponents(mensajeEncabezadoInput));
                await interaction.showModal(modal);
            } else if (interaction.customId === 'delete_compo_select') {
                await interaction.deferUpdate({ flags: [MessageFlags.Ephemeral] });
                const compoId = interaction.values[0];
                await deleteDoc(doc(db, `artifacts/${appId}/public/data/compos`, compoId));
                await interaction.editReply({ content: `✅ El template de party se ha eliminado correctamente.`, components: [] });
            }
        } else if (interaction.isButton()) {
            // ... (lógica de botones no se ve afectada)
        } else if (interaction.type === InteractionType.ModalSubmit) {
            if (interaction.customId === 'add_compo_modal') {
                await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
                const compoName = interaction.fields.getTextInputValue('compo_name');
                const compoContent = interaction.fields.getTextInputValue('compo_content');
                if (!db) return interaction.editReply('Error: La base de datos no está disponible.');
                await addDoc(composCollectionRef, { name: compoName, content: compoContent });
                await interaction.editReply(`✅ Template **${compoName}** guardado.`);
            }

            if (interaction.customId.startsWith('start_comp_modal_')) {
                await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
                const compoId = interaction.customId.split('_')[3];
                if (!db) return interaction.editReply('Error: La base de datos no está disponible.');

                const docRef = doc(db, `artifacts/${appId}/public/data/compos`, compoId);
                const selectedCompo = await getDoc(docRef);
                if (!selectedCompo.exists()) return interaction.editReply('Error: El template no fue encontrado.');
                
                const compoContent = selectedCompo.data().content;
                const horaMasseo = interaction.fields.getTextInputValue('hora_masseo');
                const tiempoFinalizacionStr = interaction.fields.getTextInputValue('tiempo_finalizacion');
                const mensajeEncabezado = interaction.fields.getTextInputValue('mensaje_encabezado');

                let totalMilisegundos = 0;
                const matchHoras = tiempoFinalizacionStr.match(/(\d+)\s*h/);
                const matchMinutos = tiempoFinalizacionStr.match(/(\d+)\s*m/);
                if (matchHoras) totalMilisegundos += parseInt(matchHoras[1]) * 3600000;
                if (matchMinutos) totalMilisegundos += parseInt(matchMinutos[1]) * 60000;

                const fechaFinalizacion = Math.floor((Date.now() + totalMilisegundos) / 1000);
                const mensajeCompleto = `${horaMasseo}\n${mensajeEncabezado || ''}\n\n**INSCRIPCIONES TERMINAN:** <t:${fechaFinalizacion}:R>\n\n${compoContent}`;

                const mensajePrincipal = await interaction.channel.send({ content: mensajeCompleto });
                const hilo = await mensajePrincipal.startThread({ name: "Inscripción de la party", autoArchiveDuration: 60 });
                
                if (db) {
                    try {
                        const partyDocRef = doc(db, 'live_parties', mensajePrincipal.id);
                        await setDoc(partyDocRef, {
                            originalContent: compoContent,
                            threadId: hilo.id,
                            createdAt: new Date()
                        });
                        console.log(`Plantilla para la party ${mensajePrincipal.id} guardada en Firebase.`);
                    } catch (error) {
                        console.error('Error CRÍTICO al guardar la plantilla inicial en Firebase:', error);
                        hilo.send('⚠️ **Alerta:** No se pudo guardar la plantilla de esta party en la base de datos. El bot puede no funcionar correctamente si se reinicia.');
                    }
                }

                const desapuntarmeButton = new ButtonBuilder().setCustomId('desapuntarme_button').setLabel('❌ Desapuntarme').setStyle(ButtonStyle.Danger);
                const buttonRow = new ActionRowBuilder().addComponents(desapuntarmeButton);
                await hilo.send({ content: "¡Escribe un número para apuntarte!", components: [buttonRow] });

                if (totalMilisegundos > 0) {
                    setTimeout(async () => {
                        try {
                            const canalHilo = await client.channels.fetch(hilo.id);
                            if (canalHilo && !canalHilo.archived && !canalHilo.locked) {
                                await canalHilo.setLocked(true);
                                await canalHilo.send('¡Las inscripciones han terminado! Este hilo ha sido bloqueado.');

                                const twentyFourHoursInMs = 24 * 60 * 60 * 1000;
                                setTimeout(async () => {
                                    try {
                                        if (db) {
                                            await deleteDoc(doc(db, 'live_parties', mensajePrincipal.id));
                                            console.log(`Documento de party ${mensajePrincipal.id} eliminado de Firebase por antigüedad.`);
                                        }
                                    } catch (error) {
                                        console.error(`Error al auto-eliminar el documento ${mensajePrincipal.id}:`, error);
                                    }
                                }, twentyFourHoursInMs);
                            }
                        } catch (error) {
                            console.error(`Error al bloquear el hilo ${hilo.id}:`, error);
                        }
                    }, totalMilisegundos);
                }
                await interaction.editReply({ content: `✅ Party iniciada en <#${hilo.id}>.` });
            }
        }
    } catch (error) {
        console.error('Error no controlado en InteractionCreate:', error);
        if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
            await interaction.reply({ content: 'Ocurrió un error inesperado.', ephemeral: true }).catch(() => {});
        }
    }
});

client.on(Events.MessageCreate, async message => {
    if (message.author.bot || !message.channel.isThread()) return;

    const { channel, author, content } = message;
    
    if (channel.locked) return;

    const mensajePrincipal = await channel.fetchStarterMessage().catch(() => null);
    if (!mensajePrincipal) return;

    const originalContent = await getOriginalContent(mensajePrincipal.id);
    if (!originalContent) {
        // Si no hay plantilla, el bot no puede operar. Borra el mensaje del usuario para evitar confusiones.
        return message.delete().catch(() => {});
    }
    const originalLines = originalContent.split('\n');
    let lineas = mensajePrincipal.content.split('\n');

    // Lógica para desapuntarse
    if (content.trim().toLowerCase() === 'desapuntar') {
        await message.delete().catch(() => {});
        const oldSpotIndex = lineas.findIndex(line => line.includes(`<@${author.id}>`));

        if (oldSpotIndex === -1) {
            return channel.send(`❌ <@${author.id}>, no estás apuntado en esta party.`).then(m => setTimeout(() => m.delete().catch(() => {}), 10000));
        }

        const oldSpotNumberMatch = lineas[oldSpotIndex].match(/^(\d+)\./);
        if (oldSpotNumberMatch) {
            const oldSpotNumber = oldSpotNumberMatch[1];
            const originalLineForOldSpot = originalLines.find(line => line.startsWith(`${oldSpotNumber}.`));
            lineas[oldSpotIndex] = originalLineForOldSpot || `${oldSpotNumber}. X`; // Fallback
            await mensajePrincipal.edit(lineas.join('\n'));
            return channel.send(`✅ <@${author.id}>, te has desapuntado del puesto **${oldSpotNumber}**.`).then(m => setTimeout(() => m.delete().catch(() => {}), 10000));
        }
        return;
    }

    const numero = parseInt(content.trim());
    if (isNaN(numero) || numero < 1 || numero > 50) return;
    
    await message.delete().catch(() => {});

    // Limpiar puesto antiguo si ya estaba apuntado
    const oldSpotIndex = lineas.findIndex(line => line.includes(`<@${author.id}>`));
    if (oldSpotIndex !== -1) {
        const oldSpotNumberMatch = lineas[oldSpotIndex].match(/^(\d+)\./);
        if (oldSpotNumberMatch) {
            const oldSpotNumber = oldSpotNumberMatch[1];
            const originalLineForOldSpot = originalLines.find(line => line.startsWith(`${oldSpotNumber}.`));
            lineas[oldSpotIndex] = originalLineForOldSpot || `${oldSpotNumber}. X`;
        }
    }

    const newSpotIndex = lineas.findIndex(linea => linea.startsWith(`${numero}.`));
    if (newSpotIndex === -1) {
        // Restaurar mensaje si el puesto no es válido
        await mensajePrincipal.edit(lineas.join('\n'));
        return channel.send(`<@${author.id}>, el número **${numero}** no es un puesto válido.`).then(m => setTimeout(() => m.delete().catch(() => {}), 10000));
    }

    if (lineas[newSpotIndex].includes('<@')) {
        // Restaurar mensaje si el puesto está ocupado
        await mensajePrincipal.edit(lineas.join('\n'));
        return channel.send(`<@${author.id}>, el puesto **${numero}** ya está ocupado.`).then(m => setTimeout(() => m.delete().catch(() => {}), 10000));
    }

    const lineaActual = lineas[newSpotIndex];
    if (lineaActual.includes('. X')) {
        const preguntaRol = await channel.send(`<@${author.id}>, te apuntas en el puesto **${numero}**. ¿Qué rol vas a ir?`);
        const filtro = m => m.author.id === author.id;
        const colector = channel.createMessageCollector({ filter: filtro, max: 1, time: 60000 });

        colector.on('collect', async m => {
            await preguntaRol.delete().catch(() => {});
            await m.delete().catch(() => {});
            const rol = m.content;
            lineas[newSpotIndex] = `${numero}. ${rol} <@${author.id}>`;
            await mensajePrincipal.edit(lineas.join('\n'));
            channel.send(`✅ <@${author.id}>, te has apuntado como **${rol}** en el puesto **${numero}**.`).then(msg => setTimeout(() => msg.delete().catch(() => {}), 10000));
        });

        colector.on('end', async collected => {
            if (collected.size === 0) {
                await preguntaRol.delete().catch(() => {});
                // Restaurar mensaje si no hay respuesta
                await mensajePrincipal.edit(lineas.join('\n'));
                channel.send(`🚫 <@${author.id}>, no respondiste a tiempo.`).then(m => setTimeout(() => m.delete().catch(() => {}), 10000));
            }
        });
    } else {
        lineas[newSpotIndex] = `${lineaActual} <@${author.id}>`;
        await mensajePrincipal.edit(lineas.join('\n'));
        channel.send(`✅ <@${author.id}>, te has apuntado en el puesto **${numero}**.`).then(m => setTimeout(() => m.delete().catch(() => {}), 10000));
    }
});


client.login(process.env.DISCORD_TOKEN);
