const Discord = require('discord.js');
const SpotifyWebApi = require('spotify-web-api-node');
const fs = require('fs');
const http = require('http');
const url = require('url');
const querystring = require('querystring');
const robot = require('robotjs');
const si = require('systeminformation');

const client = new Discord.Client({ intents: [Discord.GatewayIntentBits.Guilds, Discord.GatewayIntentBits.GuildMessages, Discord.GatewayIntentBits.MessageContent] });

const spotifyApi = new SpotifyWebApi({
  clientId: 'removed', // Replace with your Spotify Client ID
  clientSecret: 'removed', // Replace with your Spotify Client Secret
  redirectUri: 'http://localhost:8888/callback',
});

let refreshToken = null;
const refreshTokenFilePath = 'refresh_token.txt';

// Load refresh token from file if it exists
if (fs.existsSync(refreshTokenFilePath)) {
  refreshToken = fs.readFileSync(refreshTokenFilePath, 'utf8');
  spotifyApi.setRefreshToken(refreshToken);
}

async function refreshAccessToken() {
  try {
    const data = await spotifyApi.refreshAccessToken();
    spotifyApi.setAccessToken(data.body['access_token']);
  } catch (err) {
    console.error('Could not refresh access token', err);
  }
}

async function updateSystemInfoFile() {
    try {
        const cpuUsage = await si.currentLoad();
        const memUsage = await si.mem();
        const networkStats = await si.networkStats();

        const cpuPercent = cpuUsage.currentLoad.toFixed(2);
        let memPercent = 'N/A'; // Default value if memory usage is not available

        if (memUsage && memUsage.active !== undefined && memUsage.total !== undefined) {
            memPercent = ((memUsage.active / memUsage.total) * 100).toFixed(1);
        }

        const networkDown = (networkStats[0].rx_sec / (1024 * 1024)).toFixed(2);
        const networkUp = (networkStats[0].tx_sec / (1024 * 1024)).toFixed(2);

        const systemInfo = `CPU: ${cpuPercent}% | Mem: ${memPercent}% | Net D: ${networkDown} MB/s | Net U: ${networkUp} MB/s`;

        fs.writeFileSync('system_info.txt', systemInfo);
    } catch (error) {
        console.error('Error updating system info file:', error);
    }
}

async function getRefreshTokenFromWeb() {
  const authorizeURL = spotifyApi.createAuthorizeURL(['user-read-private', 'user-read-email', 'user-modify-playback-state', 'user-read-playback-state', 'user-read-recently-played', 'user-top-read'], 'state');

  console.log('Please authorize the app by visiting this URL:');
  console.log(authorizeURL);

  const server = http.createServer(async (req, res) => {
    const parsedUrl = url.parse(req.url);
    if (parsedUrl.pathname === '/callback') {
      const query = querystring.parse(parsedUrl.query);
      if (query.code) {
        try {
          const data = await spotifyApi.authorizationCodeGrant(query.code);
          refreshToken = data.body['refresh_token'];
          fs.writeFileSync(refreshTokenFilePath, refreshToken); // Save refresh token
          spotifyApi.setRefreshToken(refreshToken);
          spotifyApi.setAccessToken(data.body['access_token']);
          res.writeHead(200, { 'Content-Type': 'text/plain' });
          res.end('Authorization successful! You can close this window.');
          server.close(); // Close the server after successful authorization
        } catch (err) {
          console.error('Error getting tokens:', err);
          res.writeHead(500, { 'Content-Type': 'text/plain' });
          res.end('Authorization failed.');
          server.close();
        }
      } else {
        res.writeHead(400, { 'Content-Type': 'text/plain' });
        res.end('Authorization failed: No code received.');
        server.close();
      }
    } else {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found.');
    }
  });

  server.listen(8888, () => {
    console.log('Server listening on port 8888');
  });
}

client.once('ready', async () => {
  console.log(`Logged in as ${client.user.tag}!`);

  if (!refreshToken) {
    await getRefreshTokenFromWeb();
  } else {
    await refreshAccessToken();
  }

  setInterval(refreshAccessToken, 55 * 60 * 1000);
  //setInterval(updateVoiceChannelTopic, 10 * 1000) // update every 10 seconds
  setInterval(updateSystemInfoFile, 5000); // Update every 5 seconds (adjust as needed)
  setInterval(updateLast5, 60000); // Update every 5 seconds (adjust as needed)

});

function isUserInSameVoiceChannel(message) {
  const botVoiceChannel = message.guild.members.cache.get(client.user.id)?.voice.channel;
  const userVoiceChannel = message.member?.voice.channel;

  return botVoiceChannel && userVoiceChannel && botVoiceChannel.id === userVoiceChannel.id;
}

function formatDuration(ms) {
    const minutes = Math.floor(ms / 60000);
    const seconds = ((ms % 60000) / 1000).toFixed(0);
    return `${minutes}:${seconds.padStart(2, '0')}`;
}

async function getQueue(message) {
    try {
        const queue = await spotifyApi.getMyQueue();
        if (queue.body.queue.length === 0) {
            return message.reply('The queue is empty.');
        }

        let queueList = 'Next 10 Songs in Queue:\n';
        for (let i = 0; i < Math.min(10, queue.body.queue.length); i++) {
            const track = queue.body.queue[i];
            queueList += `${i + 1}. ${track.name} - ${track.artists[0].name}\n`;
        }
        message.reply(queueList);
    } catch (error) {
        console.error('Error getting queue:', error);
        message.reply('Failed to get the queue.');
    }
}

async function updateVoiceChannelTopic() {
    try {
        const playbackState = await spotifyApi.getMyCurrentPlaybackState();

        if (playbackState.body && playbackState.body.is_playing && playbackState.body.item) {
            const track = playbackState.body.item;
            const topic = `Now Playing: ${track.name} - ${track.artists[0].name}`;
            const voiceChannel = client.guilds.cache.find(guild => guild.members.cache.get(client.user.id)?.voice.channel)?.members.cache.get(client.user.id)?.voice.channel;
            if(voiceChannel) {
                await voiceChannel.edit({ topic: topic }); // Corrected line
            }
        } else {
            const voiceChannel = client.guilds.cache.find(guild => guild.members.cache.get(client.user.id)?.voice.channel)?.members.cache.get(client.user.id)?.voice.channel;
            if(voiceChannel){
                await voiceChannel.edit({ topic: null }); // Corrected line
            }
        }
    } catch (error) {
        console.error('Error updating voice channel topic:', error);
    }
}

async function updateLast5() { // Add message and spotifyApi as parameters
    try {
        const history = await spotifyApi.getMyRecentlyPlayedTracks({ limit: 5 });
        if (history.body.items.length === 0) {
            return message.reply('No recent tracks found.');
        }

        let fileContent = 'Last 5 Played Tracks:\n';

        history.body.items.forEach(item => {
            const track = item.track;
            fileContent += `${track.name} - ${track.artists[0].name}\n`;
            fileContent += `Played at: ${new Date(item.played_at).toLocaleString()}\n\n`;
        });

        fs.writeFileSync('last5.txt', fileContent);

    } catch (error) {
        console.error('Error updating last 5 played file:', error);
    }
}

client.on('messageCreate', async (message) => {
  if (message.channel.type === Discord.ChannelType.DM) {
    return message.reply("I do not respond to direct messages.");
  }

  if (message.content.startsWith('!search')) {

    const songName = message.content.slice(8).trim();
    if (!songName) {
      return message.reply('Please provide a song name to search.');
    }

    try {
      const searchResults = await spotifyApi.searchTracks(songName, { limit: 5 });
      if (searchResults.body.tracks.items.length === 0) {
        return message.reply('No songs found.');
      }

      const buttons = searchResults.body.tracks.items.map((track, index) =>
        new Discord.ButtonBuilder()
          .setCustomId(`track_${index}`)
          .setLabel(track.name + ' - ' + track.artists[0].name)
          .setStyle(Discord.ButtonStyle.Primary)
      );

      const row = new Discord.ActionRowBuilder().addComponents(buttons);

      const response = await message.reply({ content: 'Select a song:', components: [row] });

      const filter = (interaction) => interaction.isButton() && interaction.user.id === message.author.id;
      const collector = response.createMessageComponentCollector({ filter, time: 60000 });

      collector.on('collect', async (interaction) => {
        const trackIndex = parseInt(interaction.customId.split('_')[1]);
        const track = searchResults.body.tracks.items[trackIndex];
        const trackUri = track.uri;

        try {
          await spotifyApi.addToQueue(trackUri);
          const embed = new Discord.EmbedBuilder()
            .setTitle(track.name)
            .setURL(track.external_urls.spotify)
            .setAuthor({ name: track.artists[0].name })
            .setImage(track.album.images[0].url)
            .addFields(
                {name:"Duration", value: formatDuration(track.duration_ms)}
            )
            .setColor('#1DB954');

          await interaction.update({ content: `Added "${track.name}" to your Spotify queue.`, components: [], embeds: [embed] });
          collector.stop();
        } catch (queueError) {
          console.error('Error adding to queue:', queueError);
          await interaction.update({ content: 'Failed to add song to queue.', components: [] });
          collector.stop();
        }
      });

      collector.on('end', (collected, reason) => {
        if (reason === 'time') {
          response.edit({ content: 'Search timed out.', components: [] });
        }
      });
    } catch (searchError) {
      console.error('Error searching for song:', searchError);
      message.reply('An error occurred while searching for the song.');
    }
  } else if (message.content === '!skip') {
    try {
      await spotifyApi.skipToNext();
      message.reply('Skipped to the next song.');
    } catch (skipError) {
      console.error('Error skipping song:', skipError);
      message.reply('Failed to skip song. Make sure a device is active and playing on your Spotify account.');
    }
  } else if (message.content === '!fixbot') {
      try {
        const mousePos = robot.getMousePos();
        robot.moveMouse(mousePos.x, mousePos.y);
        robot.mouseClick('left');
        robot.mouseClick('left');
        message.reply('Music should be fixed!');
      } catch (clickError) {
        console.error('Error performing clicks:', clickError);
        message.reply('Failed to perform clicks.');
      }
    } else if (message.content === '!last5') {
        try {
            const history = await spotifyApi.getMyRecentlyPlayedTracks({ limit: 5 });
            if (history.body.items.length === 0) {
                return message.reply('No recent tracks found.');
            }
            const embed = new Discord.EmbedBuilder()
                .setTitle('Last 5 Played Tracks')
                .setColor('#1DB954');

            history.body.items.forEach(item => {
                const track = item.track;
                embed.addFields({
                    name: `${track.name} - ${track.artists[0].name}`,
                    value: `Played at: ${new Date(item.played_at).toLocaleString()}`,
                });
            });

            message.reply({ embeds: [embed] });
        } catch (error) {
            console.error('Error getting recently played tracks:', error);
            message.reply('Failed to retrieve recently played tracks.');
        }
    } else if (message.content === '!nowplaying' || message.content === '!np') {
        try {
            const playbackState = await spotifyApi.getMyCurrentPlaybackState();

            if (playbackState.body && playbackState.body.is_playing && playbackState.body.item) {
                const track = playbackState.body.item;
                const progressMs = playbackState.body.progress_ms; // Get current playback progress
                const durationMs = track.duration_ms; // Get total track duration

                const embed = new Discord.EmbedBuilder()
                    .setTitle('Now Playing')
                    .setDescription(`${track.name} - ${track.artists[0].name}`)
                    .setThumbnail(track.album.images[0].url)
                    .setURL(track.external_urls.spotify)
                    .addFields(
                        { name: 'Album', value: track.album.name, inline: true },
                        { name: 'Duration', value: `${formatDuration(progressMs)} / ${formatDuration(durationMs)}`, inline: true } // Show progress / total duration
                    )
                    .setColor('#1DB954');

                message.reply({ embeds: [embed] });
            } else {
                message.reply('Nothing is currently playing on Spotify.');
            }
        } catch (error) {
            console.error('Error getting playback state:', error);
            message.reply('Failed to retrieve current playback state.');
        }
    } else if (message.content === '!toptracks') {
        try {
            const topTracks = await spotifyApi.getMyTopTracks({ limit: 10, time_range: 'short_term' }); // You can change time_range
            if (topTracks.body.items.length === 0) {
                return message.reply('No top tracks found.');
            }

            const embed = new Discord.EmbedBuilder()
                .setTitle('Top 5 Tracks (Last few weeks)')
                .setColor('#1DB954');

            topTracks.body.items.forEach((track, index) => {
                embed.addFields({
                    name: `${index + 1}. ${track.name} - ${track.artists[0].name}`,
                    value: `Album: ${track.album.name}`,
                });
            });

            message.reply({ embeds: [embed] });
        } catch (error) {
            console.error('Error getting top tracks:', error);
            message.reply('Failed to retrieve top tracks.');
        }
    }
});
client.login('removed');
