// Dependencias del Bot de Discord y Firebase
const {
    Client, GatewayIntentBits, Partials, Events,
    ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder,
    MessageFlags, StringSelectMenuBuilder, InteractionType, 
    ButtonBuilder, ButtonStyle, EmbedBuilder // <--- AÑADIDO EmbedBuilder
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
// Asegúrate de que estos IDs sean correctos
let warnsChannelId = 'REEMPLAZAR_CON_ID_DEL_CANAL_DE_WARNS'; 
let warnsMessageId = 'REEMPLAZAR_CON_ID_DEL_MENSAJE_DE_WARNS'; 

const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';

// === CONFIGURACIÓN DE FIRESTORE ===
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
// --- NUEVA FUNCIÓN PARA CREAR EMBEDS DINÁMICAMENTE ---
function crearEmbedsDesdePlantilla(plantillaTexto) {
    const embeds = [];
    let currentEmbed = null;
    let fieldCount = 0;
    const lineas = plantillaTexto.split('\n');

    for (const linea of lineas) {
        const trimmedLine = linea.trim();
        if (!trimmedLine) continue; // Ignorar líneas vacías

        if (trimmedLine.startsWith('**Party') && trimmedLine.endsWith('**')) {
            if (currentEmbed) {
                embeds.push(currentEmbed);
            }
            currentEmbed = new EmbedBuilder()
                .setTitle(trimmedLine.replace(/\*\*/g, ''))
                .setColor(embeds.length % 2 === 0 ? '#5865F2' : '#F47B67');
            fieldCount = 0;
            continue;
        }

        if (!currentEmbed) continue;
        
        const matchRol = trimmedLine.match(/^(\d+\.\s*.*?:)(.*)$/);
        if (matchRol) {
            if (fieldCount >= 25) {
                embeds.push(currentEmbed);
                currentEmbed = new EmbedBuilder()
                    .setTitle(`${currentEmbed.data.title} (Cont.)`)
                    .setColor(currentEmbed.data.color);
                fieldCount = 0;
            }

            const nombreCampo = matchRol[1].trim();
            const valorCampo = matchRol[2].trim() || 'X';
            
            currentEmbed.addFields({ name: nombreCampo, value: valorCampo, inline: true });
            fieldCount++;
        } else {
             // Si no es un rol, lo añadimos a la descripción (por si hay notas en la plantilla)
            const desc = currentEmbed.data.description || '';
            currentEmbed.setDescription(desc + '\n' + trimmedLine);
        }
    }

    if (currentEmbed) {
        embeds.push(currentEmbed);
    }
    return embeds;
}


async function getOriginalContent(messageId) {
    if (!db) {
        console.error('Error: Se intentó llamar a getOriginalContent sin conexión a la base de datos.');
        return null;
    }
    try {
        const docRef = doc(db, 'live_parties', messageId);
        const docSnap = await getDoc(docRef);
        return docSnap.exists() ? docSnap.data().originalContent : null;
    } catch (error) {
        console.error(`Error al recuperar la plantilla de Firebase para el ID ${messageId}:`, error);
        return null;
    }
}

async function updateWarnListMessage(guild) {
    if (!db || !warnsChannelId || !warnsMessageId) return;
    try {
        const warnsChannel = await guild.channels.fetch(warnsChannelId);
        const warnsMessage = await warnsChannel.messages.fetch(warnsMessageId);

        const allWarnedUsersQuery = await getDocs(collection(db, 'warns'));
        let warnListContent = `***__WARN LIST__***\n\n`;
        let hasWarns = false;

        for (const userDoc of allWarnedUsersQuery.docs) {
            const userWarnsQuery = await getDocs(collection(db, 'warns', userDoc.id, 'list'));
            if (userWarnsQuery.size > 0) {
                hasWarns = true;
                const warns = userWarnsQuery.docs.map(doc => doc.data());
                warnListContent += `**<@${userDoc.id}>** **${warns.length}/3**\n`;
                warns.forEach((warn, index) => {
                    warnListContent += `${index + 1}. - ${warn.motivo}\n`;
                });
                warnListContent += '\n';
            }
        }
        
        if (!hasWarns) {
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
        console.error('ERROR CRÍTICO: No se pudo inicializar Firestore.', error);
        db = null;
    }
});


client.on(Events.InteractionCreate, async interaction => {
    try {
        if (interaction.isChatInputCommand()) {
            const { commandName } = interaction;
            
            if (commandName === 'start_comp') {
                await interaction.deferReply({ ephemeral: true });
                if (interaction.channel.isThread()) return interaction.editReply('Este comando solo se puede usar en un canal de texto normal.');
                if (!db) return interaction.editReply('Error: La base de datos no está disponible.');

                const composSnapshot = await getDocs(composCollectionRef);
                const options = composSnapshot.docs.map(doc => ({ label: doc.data().name, value: doc.id }));
                if (options.length === 0) return interaction.editReply('No hay compos de party guardadas. Usa `/add_compo`.');
                
                const selectMenu = new StringSelectMenuBuilder().setCustomId('select_compo').setPlaceholder('Elige un template...').addOptions(options);
                const row = new ActionRowBuilder().addComponents(selectMenu);
                await interaction.editReply({ content: 'Por favor, selecciona una compo para iniciar:', components: [row] });
            
            } else if (commandName === 'add_compo') {
                const modal = new ModalBuilder().setCustomId('add_compo_modal').setTitle('Añadir Nuevo Template de Party');
                const nombreInput = new TextInputBuilder().setCustomId('compo_name').setLabel("Nombre de la Compo").setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder('Ej: Party ZvZ');
                const mensajeInput = new TextInputBuilder().setCustomId('compo_content').setLabel("Mensaje completo de la compo").setStyle(TextInputStyle.Paragraph).setRequired(true).setPlaceholder('Pega aquí el mensaje completo...');
                modal.addComponents(new ActionRowBuilder().addComponents(nombreInput), new ActionRowBuilder().addComponents(mensajeInput));
                await interaction.showModal(modal);

            } else if (commandName === 'remove_user_compo' || commandName === 'add_user_compo') {
                await interaction.deferReply({ ephemeral: true });
                if (!interaction.channel.isThread()) return interaction.editReply('Este comando solo se puede usar dentro de un hilo de party.');
            
                const hilo = interaction.channel;
                const mensajePrincipal = await hilo.fetchStarterMessage().catch(() => null);
                if (!mensajePrincipal) return interaction.editReply('No se pudo encontrar el mensaje principal de la party.');
            
                const usuario = interaction.options.getUser('usuario');
                const originalContent = await getOriginalContent(mensajePrincipal.id);
                if (!originalContent) return interaction.editReply('Error: No se pudo encontrar la plantilla original.');
            
                const embeds = mensajePrincipal.embeds.map(e => new EmbedBuilder(e.toJSON()));
                let usuarioEncontrado = false;
            
                // Eliminar al usuario de su puesto actual
                for (const embed of embeds) {
                    for (const field of embed.data.fields) {
                        if (field.value.includes(`<@${usuario.id}>`)) {
                            const originalLines = originalContent.split('\n');
                            const originalLine = originalLines.find(line => line.trim().startsWith(field.name));
                            if(originalLine) {
                                const matchRol = originalLine.match(/^(\d+\.\s*.*?:)(.*)$/);
                                field.value = matchRol[2].trim() || 'X';
                            }
                            usuarioEncontrado = true;
                            break;
                        }
                    }
                    if (usuarioEncontrado) break;
                }
            
                if (commandName === 'remove_user_compo') {
                    if (!usuarioEncontrado) return interaction.editReply(`El usuario <@${usuario.id}> no se encuentra en la lista.`);
                    await mensajePrincipal.edit({ embeds });
                    return interaction.editReply(`✅ Usuario <@${usuario.id}> eliminado correctamente.`);
                }
            
                if (commandName === 'add_user_compo') {
                    const puesto = interaction.options.getInteger('puesto');
                    let puestoEncontrado = false;
                    for (const embed of embeds) {
                        const field = embed.data.fields.find(f => f.name.startsWith(`${puesto}.`));
                        if (field) {
                            puestoEncontrado = true;
                            if (field.value.includes('<@')) {
                                return interaction.editReply(`El puesto **${puesto}** ya está ocupado.`);
                            }
                            if (field.value.toLowerCase() === 'x') {
                                // Código para pedir rol (no implementado en este ejemplo simplificado)
                                // Por ahora, lo añadimos directamente.
                                field.value = `ROL_MANUAL <@${usuario.id}>`; // Placeholder
                                await mensajePrincipal.edit({ embeds });
                                return interaction.editReply(`✅ Usuario <@${usuario.id}> añadido al puesto **${puesto}** (rol manual).`);
                            } else {
                                field.value += ` <@${usuario.id}>`;
                                await mensajePrincipal.edit({ embeds });
                                return interaction.editReply(`✅ Usuario <@${usuario.id}> añadido al puesto **${puesto}**.`);
                            }
                        }
                    }
                    if (!puestoEncontrado) return interaction.editReply(`El puesto **${puesto}** no es válido.`);
                }
            } else if (commandName === 'delete_comp') {
                await interaction.deferReply({ ephemeral: true });
                if (!db) return interaction.editReply('Error: La base de datos no está disponible.');

                const composSnapshot = await getDocs(composCollectionRef);
                const options = composSnapshot.docs.map(doc => ({ label: doc.data().name, value: doc.id }));
                if (options.length === 0) return interaction.editReply('No hay compos guardadas para eliminar.');

                const selectMenu = new StringSelectMenuBuilder().setCustomId('delete_compo_select').setPlaceholder('Elige un template para eliminar...').addOptions(options);
                const row = new ActionRowBuilder().addComponents(selectMenu);
                await interaction.editReply({ content: 'Selecciona la compo a eliminar:', components: [row] });
            }
        } else if (interaction.isStringSelectMenu()) {
            if (interaction.customId === 'select_compo') {
                if (!db) return interaction.reply({ content: 'Error: La base de datos no está disponible.', ephemeral: true });
                
                const compoId = interaction.values[0];
                const docRef = doc(db, `artifacts/${appId}/public/data/compos`, compoId);
                const selectedCompo = await getDoc(docRef);

                if (!selectedCompo.exists()) return interaction.reply({ content: 'Error: El template no fue encontrado.', ephemeral: true });
                
                const compoName = selectedCompo.data().name;
                const modal = new ModalBuilder().setCustomId(`start_comp_modal_${compoId}`).setTitle(`Iniciar Party con: ${compoName}`);
                const horaMasseoInput = new TextInputBuilder().setCustomId('hora_masseo').setLabel("Hora del masseo?").setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder('Ej: 22:00 UTC');
                const tiempoFinalizacionInput = new TextInputBuilder().setCustomId('tiempo_finalizacion').setLabel("¿En cuánto tiempo finalizan inscripciones?").setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder('Ej: 2h 30m');
                const mensajeEncabezadoInput = new TextInputBuilder().setCustomId('mensaje_encabezado').setLabel("Mensaje de encabezado?").setStyle(TextInputStyle.Paragraph).setRequired(false).setPlaceholder('Opcional...');
                
                modal.addComponents(
                    new ActionRowBuilder().addComponents(horaMasseoInput), 
                    new ActionRowBuilder().addComponents(tiempoFinalizacionInput), 
                    new ActionRowBuilder().addComponents(mensajeEncabezadoInput)
                );
                await interaction.showModal(modal);

            } else if (interaction.customId === 'delete_compo_select') {
                await interaction.deferUpdate();
                const compoId = interaction.values[0];
                await deleteDoc(doc(db, `artifacts/${appId}/public/data/compos`, compoId));
                await interaction.editReply({ content: `✅ El template de party se ha eliminado correctamente.`, components: [] });
            }
        
        } else if (interaction.isButton()) {
            if (interaction.customId === 'desapuntarme_button') {
                await interaction.deferReply({ ephemeral: true });
    
                const user = interaction.user;
                const hilo = interaction.channel;
                if (!hilo.isThread()) return interaction.editReply('Este botón solo funciona dentro de un hilo de party.');
    
                const mensajePrincipal = await hilo.fetchStarterMessage().catch(() => null);
                if (!mensajePrincipal) return interaction.editReply('Error: No se pudo encontrar el mensaje principal.');
    
                const originalContent = await getOriginalContent(mensajePrincipal.id);
                if (!originalContent) return interaction.editReply('Error: No se pudo encontrar la plantilla original.');
                
                const embeds = mensajePrincipal.embeds.map(e => new EmbedBuilder(e.toJSON()));
                let usuarioEncontrado = false;
                let puestoDesapuntado = '';

                for (const embed of embeds) {
                    for (const field of embed.data.fields) {
                        if (field.value.includes(`<@${user.id}>`)) {
                            const originalLines = originalContent.split('\n');
                            const originalLine = originalLines.find(line => line.trim().startsWith(field.name));
                            if (originalLine) {
                                const matchRol = originalLine.match(/^(\d+\.\s*.*?:)(.*)$/);
                                field.value = matchRol[2].trim() || 'X';
                            } else {
                                // Fallback si no encuentra la linea original (poco probable)
                                field.value = 'X';
                            }
                            usuarioEncontrado = true;
                            puestoDesapuntado = field.name.match(/^(\d+)/)[1];
                            break;
                        }
                    }
                    if (usuarioEncontrado) break;
                }
    
                if (usuarioEncontrado) {
                    await mensajePrincipal.edit({ embeds });
                    await interaction.editReply(`✅ Te has desapuntado del puesto **${puestoDesapuntado}**.`);
                } else {
                    await interaction.editReply('No estás apuntado en esta party.');
                }
            }
        } else if (interaction.type === InteractionType.ModalSubmit) {
            if (interaction.customId === 'add_compo_modal') {
                await interaction.deferReply({ ephemeral: true });
                const compoName = interaction.fields.getTextInputValue('compo_name');
                const compoContent = interaction.fields.getTextInputValue('compo_content');
                if (!db) return interaction.editReply('Error: La base de datos no está disponible.');
                await addDoc(composCollectionRef, { name: compoName, content: compoContent });
                await interaction.editReply(`✅ Template **${compoName}** guardado.`);
            }

            if (interaction.customId.startsWith('start_comp_modal_')) {
                await interaction.deferReply({ ephemeral: true });
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
                const embedsParaEnviar = crearEmbedsDesdePlantilla(compoContent);

                const mensajeDeParty = {
                    content: `${horaMasseo}\n${mensajeEncabezado || ''}\n\n**INSCRIPCIONES TERMINAN:** <t:${fechaFinalizacion}:R>\n@everyone`,
                    embeds: embedsParaEnviar
                };

                const mensajePrincipal = await interaction.channel.send(mensajeDeParty);
                const hilo = await mensajePrincipal.startThread({ name: "Inscripción de la party", autoArchiveDuration: 60 });
                
                if (db) {
                    await setDoc(doc(db, 'live_parties', mensajePrincipal.id), { originalContent: compoContent, threadId: hilo.id, createdAt: new Date() });
                }

                const desapuntarmeButton = new ButtonBuilder().setCustomId('desapuntarme_button').setLabel('❌ Desapuntarme').setStyle(ButtonStyle.Danger);
                const buttonRow = new ActionRowBuilder().addComponents(desapuntarmeButton);
                await hilo.send({ content: "¡Escribe un número para apuntarte!", components: [buttonRow] });

                if (totalMilisegundos > 0) {
                    setTimeout(async () => {
                        try {
                            const canalHilo = await client.channels.fetch(hilo.id).catch(() => null);
                            if (canalHilo && !canalHilo.archived && !canalHilo.locked) {
                                await canalHilo.setLocked(true).catch(e => console.error(`No se pudo bloquear el hilo ${hilo.id}:`, e));
                                await canalHilo.send('¡Las inscripciones han terminado! Este hilo ha sido bloqueado.');
                                await deleteDoc(doc(db, 'live_parties', mensajePrincipal.id));
                            }
                        } catch (error) {
                            console.error(`Error al gestionar el final de la party para el hilo ${hilo.id}:`, error);
                        }
                    }, totalMilisegundos);
                }
                await interaction.editReply({ content: `✅ Party iniciada en <#${hilo.id}>.` });
            }
        }
    } catch (error) {
        console.error('Error no controlado en InteractionCreate:', error);
        if (interaction.replied || interaction.deferred) {
            await interaction.followUp({ content: 'Ocurrió un error al procesar tu solicitud.', ephemeral: true }).catch(()=>{});
        } else {
            await interaction.reply({ content: 'Ocurrió un error inesperado.', ephemeral: true }).catch(()=>{});
        }
    }
});

client.on(Events.MessageCreate, async message => {
    if (message.author.bot || !message.channel.isThread() || message.channel.locked) return;

    const { channel, author, content } = message;
    const mensajePrincipal = await channel.fetchStarterMessage().catch(() => null);
    if (!mensajePrincipal) return;

    const originalContent = await getOriginalContent(mensajePrincipal.id);
    if (!originalContent) return; // Si no es una party gestionada, ignorar.
    
    // --- LÓGICA MODIFICADA PARA USAR EMBEDS ---

    const embeds = mensajePrincipal.embeds.map(e => new EmbedBuilder(e.toJSON()));
    
    // Desapuntar
    if (content.trim().toLowerCase() === 'desapuntar') {
        await message.delete().catch(() => {});
        let usuarioEncontrado = false;
        let puestoDesapuntado = '';

        for (const embed of embeds) {
            for (const field of embed.data.fields) {
                if (field.value.includes(`<@${author.id}>`)) {
                    const originalLines = originalContent.split('\n');
                    const originalLine = originalLines.find(line => line.trim().startsWith(field.name));
                    field.value = originalLine ? (originalLine.match(/^(\d+\.\s*.*?:)(.*)$/)[2].trim() || 'X') : 'X';
                    usuarioEncontrado = true;
                    puestoDesapuntado = field.name.match(/^(\d+)/)[1];
                    break;
                }
            }
            if(usuarioEncontrado) break;
        }
        
        if (usuarioEncontrado) {
            await mensajePrincipal.edit({ embeds });
            return channel.send(`✅ <@${author.id}>, te has desapuntado del puesto **${puestoDesapuntado}**.`).then(m => setTimeout(() => m.delete().catch(() => {}), 10000));
        } else {
            return channel.send(`❌ <@${author.id}>, no estás apuntado.`).then(m => setTimeout(() => m.delete().catch(() => {}), 10000));
        }
    }

    // Apuntar
    const numero = parseInt(content.trim());
    if (isNaN(numero) || numero < 1 || numero > 100) return; // Aumentamos el límite por si acaso
    await message.delete().catch(() => {});

    // Primero, quitar al usuario de cualquier otro puesto que pueda tener
    let usuarioYaApuntado = false;
    for (const embed of embeds) {
        for (const field of embed.data.fields) {
            if (field.value.includes(`<@${author.id}>`)) {
                 usuarioYaApuntado = true;
                 const originalLines = originalContent.split('\n');
                 const originalLine = originalLines.find(line => line.trim().startsWith(field.name));
                 field.value = originalLine ? (originalLine.match(/^(\d+\.\s*.*?:)(.*)$/)[2].trim() || 'X') : 'X';
                 break;
            }
        }
        if(usuarioYaApuntado) break;
    }

    // Ahora, añadir al usuario al nuevo puesto
    let puestoEncontrado = false;
    for (const embed of embeds) {
        const field = embed.data.fields.find(f => f.name.startsWith(`${numero}.`));
        if (field) {
            puestoEncontrado = true;
            if (field.value.includes('<@')) {
                return channel.send(`<@${author.id}>, el puesto **${numero}** ya está ocupado.`).then(m => setTimeout(() => m.delete().catch(() => {}), 10000));
            }

            if (field.value.toLowerCase() === 'x') {
                const preguntaRol = await channel.send(`<@${author.id}>, te apuntas en el puesto **${numero}**. ¿Qué rol vas a ir?`);
                const filtro = m => m.author.id === author.id;
                const colector = channel.createMessageCollector({ filter: filtro, max: 1, time: 60000 });

                colector.on('collect', async m => {
                    await preguntaRol.delete().catch(() => {});
                    await m.delete().catch(() => {});
                    const rol = m.content;
                    field.value = `${rol} <@${author.id}>`;
                    await mensajePrincipal.edit({ embeds });
                    channel.send(`✅ <@${author.id}>, te has apuntado como **${rol}** en el puesto **${numero}**.`).then(msg => setTimeout(() => msg.delete().catch(() => {}), 10000));
                });

                colector.on('end', async collected => {
                    if (collected.size === 0) {
                        await preguntaRol.delete().catch(() => {});
                        channel.send(`🚫 <@${author.id}>, no respondiste a tiempo.`).then(m => setTimeout(() => m.delete().catch(() => {}), 10000));
                    }
                });
            } else {
                field.value += ` <@${author.id}>`;
                await mensajePrincipal.edit({ embeds });
                channel.send(`✅ <@${author.id}>, te has apuntado en el puesto **${numero}**.`).then(m => setTimeout(() => m.delete().catch(() => {}), 10000));
            }
            break; // Salimos del bucle de embeds una vez encontrado el puesto
        }
    }

    if (!puestoEncontrado) {
        return channel.send(`<@${author.id}>, el puesto **${numero}** no es un puesto válido.`).then(m => setTimeout(() => m.delete().catch(() => {}), 10000));
    }
});


client.login(process.env.DISCORD_TOKEN);
