const express = require('express');
const http = require('http');
const url = require('url');
const querystring = require('querystring');
const fs = require('fs');
const SpotifyWebApi = require('spotify-web-api-node');

const app = express();
const port = 3000;

app.set('view engine', 'ejs');
app.use(express.static('public'));

app.get('/', (req, res) => {
    res.render('index');
});

const spotifyApi = new SpotifyWebApi({
    clientId: 'removed',
    clientSecret: 'removed',
    redirectUri: 'http://localhost:8888/callback',
});

let refreshToken = null;
const refreshTokenFilePath = 'refresh_token.txt';

if (fs.existsSync(refreshTokenFilePath)) {
    refreshToken = fs.readFileSync(refreshTokenFilePath, 'utf8');
    spotifyApi.setRefreshToken(refreshToken);
    refreshAccessToken();
} else {
    getRefreshTokenFromWeb();
}

async function refreshAccessToken() {
    try {
        const data = await spotifyApi.refreshAccessToken();
        spotifyApi.setAccessToken(data.body['access_token']);
    } catch (err) {
        console.error('Could not refresh access token', err);
        getRefreshTokenFromWeb();
    }
}

async function getRefreshTokenFromWeb() {
    const authorizeURL = spotifyApi.createAuthorizeURL(
        ['user-read-private', 'user-read-email', 'user-modify-playback-state', 'user-read-playback-state', 'user-read-recently-played', 'user-top-read'],
        'state'
    );

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
                    fs.writeFileSync(refreshTokenFilePath, refreshToken);
                    spotifyApi.setRefreshToken(refreshToken);
                    spotifyApi.setAccessToken(data.body['access_token']);
                    res.writeHead(200, { 'Content-Type': 'text/plain' });
                    res.end('Authorization successful! You can close this window.');
                    server.close();
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

async function getSpotifyData() {
    try {
        await refreshAccessToken();
        const currentlyPlaying = await spotifyApi.getMyCurrentPlayingTrack();
        if (!currentlyPlaying.body || !currentlyPlaying.body.item) {
            return { currentSong: null, queue: [], recentlyPlayed: []};
        }
        const currentSong = currentlyPlaying.body.item;
        // Fetch recently played tracks
        const recentlyPlayed = await spotifyApi.getMyRecentlyPlayedTracks();

        const spotifyData = {
            currentSong: {
                title: currentSong.name,
                artist: currentSong.artists.map((artist) => artist.name).join(', '),
                progress: formatTime(currentlyPlaying.body.progress_ms),
                duration: formatTime(currentSong.duration_ms),
                artUrl: currentSong.album.images[0]?.url || null,
            },
            queue: [],
            recentlyPlayed: recentlyPlayed.body.items.map(item => ({
                title: item.track.name,
                artist: item.track.artists.map(artist => artist.name).join(', ')
            }))
        };

        return spotifyData;
    } catch (error) {
        console.error('Error fetching Spotify data:', error);
        return { currentSong: null, queue: [], recentlyPlayed: []};
    }
}

function formatTime(ms) {
    const minutes = Math.floor(ms / 60000);
    const seconds = Math.floor((ms % 60000) / 1000).toString().padStart(2, '0');
    return `${minutes}:${seconds}`;
}

async function sendSpotifyDataToClients() {
    try {
        const spotifyData = await getSpotifyData();
        console.log('Spotify Data Being Sent:', spotifyData);
        io.emit('spotifyData', spotifyData);
    } catch (error) {
        console.error('Error sending Spotify data:', error);
    }
}

// Set up Socket.IO
const server = require('http').createServer(app);
const io = require('socket.io')(server);

io.on('connection', async (socket) => {
    console.log('A user connected');
    await sendSpotifyDataToClients();
});

// Update and send Spotify data every 5 seconds
setInterval(sendSpotifyDataToClients, 5000);

server.listen(port, () => {
    console.log(`Server listening at http://localhost:${port}`);
});
