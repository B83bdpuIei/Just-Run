// Dependencias del Bot de Discord y Firebase
const {
    Client, GatewayIntentBits, Partials, Events,
    ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder,
    SlashCommandBuilder, PermissionFlagsBits, MessageFlags, StringSelectMenuBuilder,
    StringSelectMenuInteraction, InteractionType
} = require('discord.js');
const { initializeApp } = require('firebase/app');
const { getFirestore, collection, addDoc, getDocs, doc, setDoc } = require('firebase/firestore');

// Importar Express para el servidor web de Render
const express = require('express');
const app = express();
const port = process.env.PORT || 3000;

// Configuración del cliente de Discord.js
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ],
    partials: [Partials.Channel]
});

// --- Servidor Web para mantener el Bot Activo (Render) ---
app.get('/', (req, res) => {
    res.send('El bot está activo y funcionando.');
});

app.listen(port, () => {
    console.log(`Servidor web escuchando en el puerto ${port}`);
});

// --- Lógica Principal del Bot de Discord ---
const hilosMonitoreados = {};
let db;
let composCollectionRef;
const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';

// === CONFIGURACIÓN DE FIRESTORE: AÑADE TU OBJETO AQUÍ ===
// Reemplaza los valores de este objeto con los de tu proyecto de Firebase.
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

client.on('ready', async () => {
    console.log(`Hemos iniciado sesión como ${client.user.tag}`);

    // === INICIALIZACIÓN DE FIRESTORE CON MANEJADOR DE ERRORES ===
    try {
        const firebaseApp = initializeApp(firebaseConfig);
        db = getFirestore(firebaseApp);
        composCollectionRef = collection(db, `artifacts/${appId}/public/data/compos`);
        console.log('✅ Firestore inicializado con éxito.');
    } catch (error) {
        console.error('ERROR CRÍTICO: No se pudo inicializar Firestore. Las funcionalidades de base de datos no estarán disponibles.', error);
        db = null; // Asignamos null para que la lógica de los comandos lo detecte.
    }
    // =======================================================

    try {
        await client.application.commands.set([]);
        console.log('✅ Comandos antiguos eliminados.');
    } catch (error) {
        console.error('Error al eliminar comandos antiguos:', error);
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
    ];

    try {
        await client.application.commands.set(commands);
        console.log('✅ Comandos registrados exitosamente!');
    } catch (error) {
        console.error('Error al registrar comandos:', error);
    }
});

// Evento: Interacción de comandos y modals
client.on(Events.InteractionCreate, async interaction => {
    if (interaction.isChatInputCommand()) {
        const { commandName } = interaction;
        
        if (commandName === 'start_comp') {
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
            if (!hilosMonitoreados[hilo.id]) {
                await interaction.editReply('Este hilo no está monitoreado. Por favor, usa este comando en un hilo de party creado por el bot.');
                return;
            }

            const usuarioARemover = interaction.options.getUser('usuario');
            const mensajePrincipal = await hilo.fetchStarterMessage();

            if (!mensajePrincipal) {
                await interaction.editReply('No se pudo encontrar el mensaje principal de la party.');
                return;
            }

            const regexUsuario = new RegExp(`<@${usuarioARemover.id}>`);
            let lineas = mensajePrincipal.content.split('\n');
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
            
            if (numeroPuesto >= 35) {
                lineas[lineaEncontrada] = `${numeroPuesto}. X`;
            } else {
                lineas[lineaEncontrada] = lineas[lineaEncontrada].split(`<@${usuarioARemover.id}>`)[0].trim();
            }

            await mensajePrincipal.edit(lineas.join('\n'));

            if (hilosMonitoreados[hilo.id]) {
                hilosMonitoreados[hilo.id].participantes.delete(usuarioARemover.id);
            }

            await interaction.editReply(`✅ Usuario <@${usuarioARemover.id}> eliminado del puesto **${numeroPuesto}**.`);
            
        } else if (commandName === 'add_user_compo') {
            // CORRECCIÓN: DeferReply para responder a tiempo
            await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

            if (!interaction.channel.isThread()) {
                await interaction.editReply('Este comando solo se puede usar dentro de un hilo de party.');
                return;
            }
            
            const hilo = interaction.channel;

            // CORRECCIÓN: Añadimos una comprobación más robusta.
            if (!hilo.guild || !hilosMonitoreados[hilo.id]) {
                await interaction.editReply('Este hilo no está siendo monitoreado por el bot. Por favor, usa este comando en un hilo de party creado recientemente.');
                return;
            }

            const usuarioAAgregar = interaction.options.getUser('usuario');
            const puestoAAgregar = interaction.options.getInteger('puesto');
            const mensajePrincipal = await hilo.fetchStarterMessage();

            if (!mensajePrincipal) {
                await interaction.editReply('No se pudo encontrar el mensaje principal de la party.');
                return;
            }
            
            let lineas = mensajePrincipal.content.split('\n');
            const regexUsuario = new RegExp(`<@${usuarioAAgregar.id}>`);
            const lineaAnteriorIndex = lineas.findIndex(linea => regexUsuario.test(linea));
            
            if (lineaAnteriorIndex !== -1) {
                const numeroPuestoAnterior = parseInt(lineas[lineaAnteriorIndex].trim().split('.')[0]);
                if (numeroPuestoAnterior >= 35) {
                    lineas[lineaAnteriorIndex] = `${numeroPuestoAnterior}. X`;
                } else {
                    lineas[lineaAnteriorIndex] = lineas[lineaAnteriorIndex].split(`<@${usuarioAAgregar.id}>`)[0].trim();
                }
                if (hilosMonitoreados[hilo.id]) {
                    hilosMonitoreados[hilo.id].participantes.delete(usuarioAAgregar.id);
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

            if (puestoAAgregar >= 35) {
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
                    
                    if (hilosMonitoreados[hilo.id]) {
                        hilosMonitoreados[hilo.id].participantes.set(usuarioAAgregar.id, puestoAAgregar);
                    }
                    colector.stop();
                });

                colector.on('end', collected => {
                    if (collected.size === 0) {
                        interaction.editReply(`🚫 No respondiste a tiempo. El usuario <@${usuarioAAgregar.id}> no ha sido añadido.`);
                    }
                });
            } else {
                const lineaOriginal = lineas[lineaNuevaIndex];
                const nuevoValor = `${lineaOriginal} <@${usuarioAAgregar.id}>`;
                lineas[lineaNuevaIndex] = nuevoValor;
                await mensajePrincipal.edit(lineas.join('\n'));

                if (hilosMonitoreados[hilo.id]) {
                    hilosMonitoreados[hilo.id].participantes.set(usuarioAAgregar.id, puestoAAgregar);
                }
                
                await interaction.editReply(`✅ Usuario <@${usuarioAAgregar.id}> añadido al puesto **${puestoAAgregar}**.`);
            }
        }
    } else if (interaction.isStringSelectMenu()) {
        if (interaction.customId === 'select_compo') {
            await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

            if (!db) {
                await interaction.editReply({ content: 'Error: La base de datos no está disponible. Por favor, inténtalo de nuevo más tarde.', flags: [MessageFlags.Ephemeral] });
                return;
            }

            try {
                const compoId = interaction.values[0];
                const composSnapshot = await getDocs(composCollectionRef);
                const selectedCompo = composSnapshot.docs.find(doc => doc.id === compoId);
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
                await interaction.editReply({ content: 'Hubo un error al cargar los templates de party.', flags: [MessageFlags.Ephemeral] });
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
                const compoSnapshot = await getDocs(composCollectionRef);
                const selectedCompo = compoSnapshot.docs.find(doc => doc.id === compoId);
                if (!selectedCompo) {
                    await interaction.editReply('Error: El template de party no fue encontrado.');
                    return;
                }
                const compoContent = selectedCompo.data().content;

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

                // Envía el mensaje de la party al canal principal
                const mensajeInicial = await interaction.channel.send({ content: mensajeCompleto });
                
                const hilo = await mensajeInicial.startThread({
                    name: "Inscripción de la party",
                    autoArchiveDuration: 60,
                });

                hilosMonitoreados[hilo.id] = {
                    mensajeId: mensajeInicial.id,
                    participantes: new Map()
                };

                await hilo.send("¡Escribe un número para apuntarte!");

                if (totalMilisegundos > 0) {
                    await hilo.send(`El hilo se bloqueará automáticamente en **${tiempoFinalizacionStr}**.`);

                    setTimeout(async () => {
                        try {
                            const canalHilo = client.channels.cache.get(hilo.id);
                            if (canalHilo && !canalHilo.archived) {
                                await canalHilo.setLocked(true);
                                await canalHilo.send('¡Las inscripciones han terminado! Este hilo ha sido bloqueado y ya no se pueden añadir más participantes.');
                            }
                            
                            delete hilosMonitoreados[hilo.id];
                        } catch (error) {
                            console.error(`Error al bloquear el hilo ${hilo.id}:`, error);
                        }
                    }, totalMilisegundos);
                }

                // Edita el mensaje de "pensando" para indicar que la party se creó, de forma privada
                await interaction.editReply({ content: `✅ La party se ha iniciado correctamente. Puedes verla en <#${hilo.id}>.`, flags: [MessageFlags.Ephemeral] });

            } catch (error) {
                console.error('Error al crear la party o el hilo:', error);
                await interaction.editReply({ content: 'Hubo un error al intentar crear la party. Por favor, asegúrate de que el bot tenga los permisos necesarios.', flags: [MessageFlags.Ephemeral] });
            }
        }
    }
});

// Evento: Mensajes en el canal para las inscripciones
client.on(Events.MessageCreate, async message => {
    // Solo procesa mensajes que estén en un hilo que estamos monitoreando
    if (message.author.bot || !message.channel.isThread() || !hilosMonitoreados[message.channel.id]) {
        return;
    }
    
    const { channel, author, content } = message;
    const hiloInfo = hilosMonitoreados[channel.id];
    const numero = parseInt(content.trim());
    
    // Si el mensaje no es un número válido, lo ignoramos
    if (isNaN(numero) || numero < 1 || numero > 50) {
        return;
    }

    try {
        await message.delete();
        const canalPrincipal = await channel.parent.fetch();
        const mensajeAEditar = await canalPrincipal.messages.fetch(hiloInfo.mensajeId);
        let lineas = mensajeAEditar.content.split('\n');
        const oldSpot = hiloInfo.participantes.get(author.id);
    
        // Si el usuario ya está apuntado, lo eliminamos de su puesto anterior
        if (oldSpot) {
            const lineaAnterior = lineas.findIndex(linea => linea.startsWith(`${oldSpot}.`));
            if (lineaAnterior !== -1) {
                if (oldSpot >= 35) {
                    lineas[lineaAnterior] = `${oldSpot}. X`;
                } else {
                    lineas[lineaAnterior] = lineas[lineaAnterior].split(`<@${author.id}>`)[0].trim();
                }
                hiloInfo.participantes.delete(author.id);
            }
        }
    
        const indiceLinea = lineas.findIndex(linea => linea.startsWith(`${numero}.`));
    
        if (indiceLinea !== -1) {
            if (lineas[indiceLinea].includes('<@')) {
                const mensajeOcupado = await channel.send(`<@${author.id}>, ese puesto ya está ocupado. Intenta con otro número.`);
                setTimeout(() => mensajeOcupado.delete().catch(() => {}), 10000);
                return;
            }
    
            if (numero <= 34) {
                const lineaOriginal = lineas[indiceLinea];
                const nuevoValor = `${lineaOriginal} <@${author.id}>`;
                lineas[indiceLinea] = nuevoValor;
                await mensajeAEditar.edit(lineas.join('\n'));
                hiloInfo.participantes.set(author.id, numero);
                await channel.send(`<@${author.id}>, te has apuntado en el puesto **${numero}** con éxito.`).then(m => setTimeout(() => m.delete().catch(() => {}), 10000));
            } else {
                const preguntaRol = await channel.send(`<@${author.id}>, te has apuntado en el puesto **${numero}**. ¿Qué rol vas a ir?`);
                
                const filtro = m => m.author.id === author.id;
                const colector = channel.createMessageCollector({ filter: filtro, max: 1, time: 60000 });
    
                colector.on('collect', async m => {
                    await preguntaRol.delete().catch(() => {});
                    await m.delete().catch(() => {});
                    const rol = m.content;
                    const nuevoValor = `${numero}. ${rol} <@${author.id}>`;
                    lineas[indiceLinea] = nuevoValor;
                    await mensajeAEditar.edit(lineas.join('\n'));
                    hiloInfo.participantes.set(author.id, numero);
                    await channel.send(`<@${author.id}>, te has apuntado en el puesto **${numero}** como **${rol}**.`).then(m => setTimeout(() => m.delete().catch(() => {}), 10000));
                });
    
                colector.on('end', collected => {
                    if (collected.size === 0) {
                        channel.send(`<@${author.id}>, no respondiste a tiempo. Por favor, vuelve a intentarlo.`).then(m => setTimeout(() => m.delete().catch(() => {}), 10000));
                    }
                });
            }
        }
    } catch (error) {
        console.error('Error procesando mensaje en el hilo:', error);
        channel.send(`Hubo un error al procesar tu solicitud, <@${author.id}>. Por favor, inténtalo de nuevo.`).then(m => setTimeout(() => m.delete().catch(() => {}), 10000));
    }
});

client.login(process.env.TOKEN);
