// deploy-commands.js

// Requerimos las clases necesarias de la librería discord.js
const { REST, Routes, SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');

// Usaremos dotenv para cargar las variables de entorno desde un archivo .env
// Asegúrate de instalarlo con: npm install dotenv
require('dotenv').config();

// --- Definición de Comandos ---
// Copiamos aquí exactamente los mismos comandos que tienes en tu index.js
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
]
.map(command => command.toJSON()); // Convertimos cada comando a formato JSON para la API

// --- Lectura de Variables de Entorno ---
const token = process.env.DISCORD_TOKEN;
const clientId = process.env.CLIENT_ID;
const guildId = process.env.GUILD_ID;

// Comprobamos que las variables necesarias existan
if (!token || !clientId || !guildId) {
    console.error('Error: Faltan variables de entorno cruciales. Asegúrate de que DISCORD_TOKEN, CLIENT_ID y GUILD_ID están en tu archivo .env');
    process.exit(1); // Salimos del script si faltan variables
}

// Creamos una instancia del módulo REST
const rest = new REST({ version: '10' }).setToken(token);

// --- Lógica de Despliegue ---
// Usamos una función autoejecutable asíncrona para desplegar los comandos
(async () => {
    try {
        console.log(`[DEPLOY] Empezando a registrar ${commands.length} comandos de aplicación (/).`);

        // El método 'put' actualiza todos los comandos en el servidor con el set actual
        const data = await rest.put(
            // Registramos los comandos específicamente para tu servidor (guild).
            // Esto es más rápido que registrar globalmente y es ideal para desarrollo y bots privados.
            Routes.applicationGuildCommands(clientId, guildId),
            { body: commands },
        );

        console.log(`[DEPLOY] ✅ Se han registrado con éxito ${data.length} comandos de aplicación (/).`);
    } catch (error) {
        // Nos aseguramos de capturar y mostrar cualquier error que ocurra
        console.error('[DEPLOY] ❌ Error al registrar los comandos:', error);
    }
})();
