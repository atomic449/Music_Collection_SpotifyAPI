const express = require('express');
var mssql = require('mssql');
const axios = require('axios');
const path = require('path');

const bodyParser = require('body-parser');
const session = require('express-session');
const cookieParser = require('cookie-parser');
const { dbConfig } = require('./config');
const app = express();
const PORT = 8080;

const SPOTIFY_CLIENT_ID = '6c6ddef7d9704df5a6615017f4d47780';
const SPOTIFY_CLIENT_SECRET = '64ac66c268b144dab5215974474a2f18';

app.use(express.static('public'));
app.use(express.json());
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

app.use(cookieParser());
app.use(session({
    saveUninitialized: true,
    resave: false,
    secret: 'supersecret'
}));

const getAccessToken = async () => {
    const tokenUrl = 'https://accounts.spotify.com/api/token';
    const response = await axios.post(tokenUrl, new URLSearchParams({
        grant_type: 'client_credentials'
    }), {
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Authorization': 'Basic ' + Buffer.from(`${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`).toString('base64')
        }
    });
    return response.data.access_token;
};

function isAuthenticated(req, res, next) {
    if (req.session.username) {
        next(); 
    } else {
        res.sendFile(path.join(__dirname, 'public', 'login.html'));
    }
}
const fetchSongsFromSpotify = async (spotifyIds, accessToken) => {
    const songDetails = [];

    for (const spotifyId of spotifyIds) {
        const response = await axios.get(`https://api.spotify.com/v1/tracks/${spotifyId}`, {
            headers: {
                Authorization: `Bearer ${accessToken}`
            }
        });

        const song = response.data;
        songDetails.push({
            id: song.id,
            name: song.name,
            artist: song.artists[0].name,
            album: song.album.name,
            albumCover: song.album.images[0]?.url
        });
    }

    return songDetails;
};
const getAlbumCoverFromSpotify = async (spotifyId) => {
    if (!spotifyId) return null;
    const accessToken = await getAccessToken();
    const response = await axios.get(`https://api.spotify.com/v1/tracks/${spotifyId}`, {
        headers: {
            Authorization: `Bearer ${accessToken}`
        }
    });
    return response.data.album.images[0]?.url;
};

app.get('/', (req, res) => {
    if (req.session.username) {
        res.redirect('/home');
    } else {
        res.sendFile(path.join(__dirname, 'public', 'login.html'));
    }
});
app.get('/home', isAuthenticated, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'home.html'));
});
app.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
});
app.get('/register', (req, res) => {
    res.sendFile(path.join(__dirname,  'public', 'register.html'));
});

app.get('/create-collection', isAuthenticated, async (req, res) => {
    const collectionId = parseInt(req.query.id, 10);
    console.log('Collection is:'+ collectionId);

    if (isNaN(collectionId)) {
        return res.status(400).send('Invalid Collection ID Create');
    }
    try {
        const pool = await mssql.connect(dbConfig);
        
        const collectionQuery = `
            SELECT * FROM Collections
            WHERE Id = @collectionId AND User_Id = @userId
        `;
        
        const collectionResult = await pool.request()
            .input('collectionId', mssql.Int, collectionId)
            .input('userId', mssql.Int, req.session.userId)
            .query(collectionQuery);
        
        const collection = collectionResult.recordset[0];
        if (!collection) {
            return res.status(404).send('Collection not found');
        }

        const songQuery = `
            SELECT Spotify_Id FROM Collection_Song
            WHERE Collection_Id = @collectionId
        `;
        
        const songResult = await pool.request()
            .input('collectionId', mssql.Int, collectionId)
            .query(songQuery);
        
        const spotifyIds = songResult.recordset.map(row => row.Spotify_Id);
        const accessToken = await getAccessToken();
        const songDetails = await fetchSongsFromSpotify(spotifyIds, accessToken);
        
        res.render('create-collection', {
            collectionName: collection.Name,
            collectionDescription: collection.Description,
            collectionId: collection.Id,
            songs: songDetails
        });
    } catch (error) {
        console.error('SQL error', error);
        res.status(500).send('Server Error');
    }
});

app.post('/create-collection', isAuthenticated, async (req, res) => {
    const userId = req.session.userId; 
    try {
        const pool = await mssql.connect(dbConfig);
        const countQuery = `
            SELECT COUNT(*) AS total FROM Collections WHERE User_Id = @UserId;
        `;
        const countResult = await pool.request()
            .input('UserId', mssql.Int, userId)
            .query(countQuery);
        
        const totalCollections = countResult.recordset[0].total;
        const insertQuery = `
            INSERT INTO Collections (User_Id, Name, Description, Type)
            OUTPUT INSERTED.*
            VALUES (@UserId, @Name, @Description, @Type);
        `;
        
        const insertResult = await pool.request()
            .input('UserId', mssql.Int, userId)
            .input('Name', mssql.VarChar, `Collection #${totalCollections + 1}`)
            .input('Description', mssql.VarChar, 'Default Description')
            .input('Type', mssql.VarChar, 'song')
            .query(insertQuery);

        const createdCollection = insertResult.recordset[0];
        res.json(createdCollection);
    } catch (error) {
        console.error('Error creating collection:', error);
        res.status(500).send('Error creating collection');
    }
});

app.get('/edit-collection/:id', isAuthenticated, async (req, res) => {
    const collectionId = parseInt(req.params.id, 10);
    if (isNaN(collectionId)) {
        return res.status(400).send('Invalid Collection ID Edit');
    }
    console.log('Collection ID Edit:', collectionId);
    console.log('Request Body:', req.body);
    try {
        const pool = await mssql.connect(dbConfig);

        const query = `SELECT * FROM Collections WHERE Id = @collectionId AND User_Id = @userId`;
        const result = await pool.request()
            .input('collectionId', mssql.Int, collectionId)
            .input('userId', mssql.Int, req.session.userId)
            .query(query);
        
        const collection = result.recordset[0];
        if (!collection) {
            return res.status(404).send('Collection not found');
        }

        res.render('edit-collections', {
            collectionName: collection.Name,
            collectionDescription: collection.Description,
            collectionType: collection.Type,
            collectionId: collection.Id
        });
    } catch (error) {
        console.error('SQL error', error);
        res.status(500).send('Server Error');
    }
});

app.post('/edit-collection/:id', isAuthenticated, async (req, res) => {
    const collectionId = req.params.id;
    const { name, description, type } = req.body;
    try {
        const pool = await mssql.connect(dbConfig);
        const updateQuery = `
            UPDATE Collections
            SET Name = @name, Description = @description, Type = @type
            WHERE Id = @collectionId AND User_Id = @userId;
        `;
        await pool.request()
            .input('name', mssql.VarChar, name)
            .input('description', mssql.VarChar, description)
            .input('type', mssql.VarChar, type)
            .input('collectionId', mssql.Int, collectionId)
            .input('userId', mssql.Int, req.session.userId)
            .query(updateQuery);

        res.json({ message: 'Collection updated successfully' });
    } catch (error) {
        console.error('Error updating collection:', error);
        res.status(500).send('Error updating collection');
    }
});

app.get('/add-song', isAuthenticated, async (req, res) => {
    const collectionId = req.query.collectionId;
    res.render('add-song', { collectionId });
});

app.post('/add-song', isAuthenticated, async (req, res) => {
    const { spotifyId, collectionId } = req.body;
    console.log(`Spotify ID: ${spotifyId}, Collection ID: ${collectionId}`);
    try {
        const pool = await mssql.connect(dbConfig);
        
        const insertQuery = `
            INSERT INTO Collection_Song (Collection_Id, Spotify_Id)
            VALUES (@collectionId, @spotifyId);
        `;

        await pool.request()
            .input('collectionId', mssql.Int, collectionId)
            .input('spotifyId', mssql.VarChar, spotifyId)
            .query(insertQuery);

        res.json({ message: 'Song added successfully to the collection', spotifyId, collectionId });
    } catch (error) {
        console.error('Error adding song to collection:', error);
        res.status(500).json({ error: 'Error adding song to collection' });
    }
});

app.post('/search', async (req, res) => {
    const { query, offset, limit } = req.body; 
    try {
        const accessToken = await getAccessToken();
        let allSongs = [];

        const searchUrl = `https://api.spotify.com/v1/search?q=${encodeURIComponent(query)}&type=track&limit=${limit}&offset=${offset}`;
        const response = await axios.get(searchUrl, {
            headers: {
                Authorization: `Bearer ${accessToken}`
            }
        });

        const songs = response.data.tracks.items.map(track => ({
            id: track.id,
            name: track.name,
            artist: track.artists[0].name,
            album: track.album.name,
            albumCover: track.album.images[0]?.url
        }));

        allSongs = allSongs.concat(songs);
        res.json(allSongs);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Something went wrong' });
    }
});

app.post('/delete-song', isAuthenticated, async (req, res) => {
    const { spotifyId, collectionId } = req.body; 
    try {
        const pool = await mssql.connect(dbConfig);
        const deleteQuery = `
            DELETE FROM Collection_Song
            WHERE Spotify_Id = @spotifyId AND Collection_Id = @collectionId;
        `;
        
        await pool.request()
            .input('spotifyId', mssql.VarChar, spotifyId)
            .input('collectionId', mssql.Int, collectionId)
            .query(deleteQuery);

        res.redirect(`/create-collection?id=${collectionId}`);
    } catch (error) {
        console.error('Error deleting song from collection:', error);
        res.status(500).json({ error: 'Error deleting song from collection' });
    }
});
app.post('/delete-collection', isAuthenticated, async (req, res) => {
    const { collectionId } = req.body;

    try {
        const pool = await mssql.connect(dbConfig);

        const deleteSongsQuery = `
            DELETE FROM Collection_Song
            WHERE Collection_Id = @collectionId;
        `;

        await pool.request()
            .input('collectionId', mssql.Int, collectionId)
            .query(deleteSongsQuery);

        const deleteCollectionQuery = `
            DELETE FROM Collections
            WHERE Id = @collectionId AND User_Id = @userId;
        `;
        await pool.request()
            .input('collectionId', mssql.Int, collectionId)
            .input('userId', mssql.Int, req.session.userId)
            .query(deleteCollectionQuery);
        res.redirect('/home');
    } catch (error) {
        console.error('Error deleting collection:', error);
        res.status(500).json({ error: 'Error deleting collection' });
    }
});

app.get('/my-collections', isAuthenticated, async (req, res) => {
    try {
        const pool = await mssql.connect(dbConfig);
        const userId = req.session.userId;

        const query = `
            SELECT c.Id, c.Name, (SELECT TOP 1 cs.Spotify_Id FROM Collection_Song cs WHERE cs.Collection_Id = c.Id) AS Spotify_Id
            FROM Collections c
            WHERE c.User_Id = @userId
        `;
        
        const result = await pool.request()
            .input('userId', mssql.Int, userId)
            .query(query);
        
     
        const collections = await Promise.all(result.recordset.map(async collection => {
            const albumCoverUrl = await getAlbumCoverFromSpotify(collection.Spotify_Id);
            return { ...collection, albumCover: albumCoverUrl };
        }));

        res.render('my-collections', { collections });
    } catch (error) {
        console.error('SQL error', error);
        res.status(500).send('Server Error');
    }
});

app.post('/login', async function (req, res) {
    try {
        const pool = await mssql.connect(dbConfig);
        const { username, password } = req.body;
        
        const userQuery = 'SELECT * FROM Users WHERE Login = @Username AND Password = @Password';
        const userResult = await pool.request()
            .input('Username', mssql.VarChar, username)
            .input('Password', mssql.VarChar, password)
            .query(userQuery);
            if (userResult.recordset.length > 0) {
                const user = userResult.recordset[0];
                req.session.userId = user.Id;
                req.session.username = username;
                return res.json({ success: true, message: 'User login succeeded', username });
            }
        res.status(401).json({ success: false, message: 'Login error' });
    } catch (error) {
        console.error('SQL error', error);
        res.status(500).send('Server Error');
    }
});

app.get('/logout', function (req, res) {
    req.session.destroy((err) => {
        if (err) {
            return res.status(500).send('Logout failed');
        }
        res.send('Logged out');
    });
});
app.post('/register', async function (req, res) {
    try {
        const { username, password } = req.body;
        if (!username || !password) {
            return res.status(400).json({ success: false, message: 'All fields are required' });
        }

        const pool = await mssql.connect(dbConfig);

        const userCheckQuery = 'SELECT * FROM Users WHERE Login = @Username';
        const checkResult = await pool.request()
            .input('Username', mssql.VarChar, username)
            .query(userCheckQuery);

        if (checkResult.recordset.length > 0) {
            return res.status(400).json({ success: false, message: 'Username already exists' });
        }

        const insertUserQuery = 'INSERT INTO Users (Login, Password) VALUES (@Username, @Password)';
        await pool.request()
            .input('Username', mssql.VarChar, username)
            .input('Password', mssql.VarChar, password)
            .query(insertUserQuery);

        res.json({ success: true, message: 'Registration successful' });
    } catch (error) {
        console.error('SQL error', error);
        res.status(500).json({ success: false, message: 'Server Error' });
    }
});

app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
