const { REST, Routes } = require('discord.js');
// Asegúrate de tener tu archivo config.json o pon aquí los datos.
const { clientId, guildId, token } = require('./config.json');

const commands = [
    {
        name: 'start_comp',
        description: 'Inicia una nueva party usando una plantilla guardada.'
    },
    {
        name: 'add_compo',
        description: 'Añade una nueva plantilla de composición de party.'
    },
    {
        name: 'delete_comp',
        description: 'Elimina una plantilla de composición de party existente.'
    },
    {
        name: 'remove_user_compo',
        description: 'Elimina a un usuario de un puesto en la party actual.',
        options: [
            {
                name: 'usuario',
                type: 6, // USER
                description: 'El usuario a eliminar.',
                required: true
            }
        ]
    },
    {
        name: 'add_user_compo',
        description: 'Añade a un usuario a un puesto en la party actual.',
        options: [
            {
                name: 'usuario',
                type: 6, // USER
                description: 'El usuario a añadir.',
                required: true
            },
            {
                name: 'puesto',
                type: 4, // INTEGER
                description: 'El número del puesto al que se va a añadir.',
                required: true
            }
        ]
    }
];

const rest = new REST({ version: '10' }).setToken(token);

(async () => {
    try {
        console.log('Empezando a refrescar los comandos de aplicación (/).');

        await rest.put(
            Routes.applicationGuildCommands(clientId, guildId),
            { body: commands },
        );

        console.log('Comandos de aplicación (/) recargados con éxito.');
    } catch (error) {
        console.error(error);
    }
})();
