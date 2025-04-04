const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const fs = require('fs').promises; // Using promises version

const app = express();
const port = process.env.PORT || 3000;

// Define the path for the leaderboard data file.
// IMPORTANT: Ensure this path is correct for your deployment environment (e.g., Render).
// It assumes leaderboard.json is in the SAME directory as this script runs.
// If it's one level up (at the project root), use path.join(__dirname, '..', 'leaderboard.json');
const leaderboardFile = path.join(__dirname, 'leaderboard.json');

console.log(`Leaderboard file path: ${leaderboardFile}`); // Log the path on startup

// --- Middleware ---

// Parse JSON request bodies
app.use(bodyParser.json());

// CORS Headers - ESSENTIAL if your frontend is on a different origin
app.use((req, res, next) => {
    // In production, replace '*' with your frontend's actual domain for better security
    // e.g., res.header('Access-Control-Allow-Origin', 'https://your-frontend-app.com');
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
    // Allow GET, POST, and the preflight OPTIONS request
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');

    // Handle preflight requests (sent by browsers before POST/PUT etc. with certain headers)
    if (req.method === 'OPTIONS') {
        return res.sendStatus(200);
    }
    next();
});

// --- Initialization Function ---
async function initializeLeaderboard() {
    try {
        await fs.access(leaderboardFile);
        console.log('Leaderboard file found.');
        try {
            const data = await fs.readFile(leaderboardFile, 'utf8');
            JSON.parse(data);
            if (!Array.isArray(JSON.parse(data))) {
                 console.warn('Leaderboard file does not contain an array. Re-initializing.');
                 await fs.writeFile(leaderboardFile, '[]', 'utf8');
            }
        } catch (parseError) {
            console.warn('Leaderboard file contains invalid JSON. Initializing with empty array.');
            await fs.writeFile(leaderboardFile, '[]', 'utf8');
        }
    } catch (error) {
        if (error.code === 'ENOENT') {
            console.log('Leaderboard file not found. Creating...');
        } else {
            console.error('Error accessing leaderboard file on init:', error);
        }
        try {
            await fs.writeFile(leaderboardFile, '[]', 'utf8');
            console.log('Leaderboard file initialized successfully.');
        } catch (writeError) {
            console.error('FATAL: Could not create leaderboard file! Check permissions.', writeError);
            process.exit(1);
        }
    }
}

// --- API Routes ---

// GET Leaderboard
app.get('/api/leaderboard', async (req, res) => {
    console.log("GET /api/leaderboard request received");
    try {
        const data = await fs.readFile(leaderboardFile, 'utf8');
        res.json(JSON.parse(data));
    } catch (error) {
        // Check if the error is because the file doesn't exist *after* initialization tried
        if (error.code === 'ENOENT') {
             console.error('Leaderboard file missing during GET request. Returning empty array.');
             res.json([]); // Return empty array if file is missing
        } else {
            console.error('Error reading leaderboard file for GET:', error);
            res.status(500).json({ error: 'Failed to retrieve leaderboard data.' });
        }
    }
});

// POST New Score
app.post('/api/leaderboard', async (req, res) => {
    console.log("POST /api/leaderboard request received");
    try {
        const { name, score } = req.body;
        console.log(`Received data: Name=${name}, Score=${score}`);

        if (!name || typeof name !== 'string' || name.trim().length === 0 || typeof score !== 'number' || isNaN(score)) {
            console.error('Invalid data received:', req.body);
            return res.status(400).json({ error: 'Invalid data: Name must be a non-empty string and score must be a number.' });
        }

        const sanitizedName = name.substring(0, 15).trim();
        const validatedScore = Math.min(Math.max(0, score), 999999);

        console.log(`Processing: Name=${sanitizedName}, Score=${validatedScore}`);

        let leaderboard = [];
        try {
            const rawData = await fs.readFile(leaderboardFile, 'utf8');
            leaderboard = JSON.parse(rawData);
            if (!Array.isArray(leaderboard)) {
               console.warn('Leaderboard file did not contain a valid array. Resetting.');
               leaderboard = [];
            }
            console.log(`Read ${leaderboard.length} entries from leaderboard file.`);
        } catch (readError) {
            if (readError.code === 'ENOENT') {
                console.warn('Leaderboard file missing during POST read. Starting with empty array.');
                leaderboard = []; // Start fresh if file doesn't exist
            } else {
                console.error('Error reading leaderboard file during POST:', readError);
                // Depending on the error, you might want to stop here or proceed with an empty array
                leaderboard = []; // Proceed cautiously
            }
        }

        const existingIndex = leaderboard.findIndex(entry => entry.name === sanitizedName);
        let updated = false;

        if (existingIndex > -1) {
            if (validatedScore > leaderboard[existingIndex].score) {
                console.log(`Updating score for ${sanitizedName} from ${leaderboard[existingIndex].score} to ${validatedScore}`);
                leaderboard[existingIndex].score = validatedScore;
                leaderboard[existingIndex].date = new Date().toISOString();
                updated = true;
            } else {
                console.log(`Score for ${sanitizedName} (${validatedScore}) is not higher than existing (${leaderboard[existingIndex].score}). No update.`);
            }
        } else {
            console.log(`Adding new entry for ${sanitizedName} with score ${validatedScore}`);
            leaderboard.push({
                name: sanitizedName,
                score: validatedScore,
                date: new Date().toISOString()
            });
            updated = true;
        }

        let top10 = leaderboard;
        if (updated) {
            leaderboard.sort((a, b) => {
                if (b.score !== a.score) return b.score - a.score;
                return new Date(a.date) - new Date(b.date);
            });
            top10 = leaderboard.slice(0, 10);
            console.log(`Leaderboard updated. Top 10 size: ${top10.length}`);
        }

        try {
            console.log('Attempting to write updated leaderboard back to file...');
            await fs.writeFile(leaderboardFile, JSON.stringify(top10, null, 2), 'utf8');
            console.log('Successfully wrote updated leaderboard to file.');
            res.status(200).json(top10);
        } catch (writeError) {
            console.error('!!!!!!!!!! FAILED TO WRITE LEADERBOARD FILE !!!!!!!!!!', writeError);
            res.status(500).json({ error: 'Server error: Could not save the score.' });
        }

    } catch (error) {
        console.error('Unexpected error in POST /api/leaderboard handler:', error);
        res.status(500).json({ error: 'An unexpected server error occurred.' });
    }
});

// --- Start Server ---
initializeLeaderboard().then(() => {
    app.listen(port, () => {
        console.log(`API Server running successfully on http://localhost:${port}`); // Changed log message
    });
}).catch(error => {
    console.error("Server failed to start due to initialization error:", error);
    process.exit(1);
});