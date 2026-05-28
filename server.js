const express = require('express');
const axios = require('axios');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const SHEET_ID = '1xzpkFZKZNFEdefIQK2U-OZA-5uTqIeOVWNtUHVX77Ww';

// Serve static frontend files from 'public' directory
app.use(express.static(path.join(__dirname, 'public')));

// API endpoint to fetch Google Sheets data
app.get('/api/jobs', async (req, res) => {
    try {
        const { day } = req.query;
        if (!day) {
            return res.status(400).json({ error: 'Missing day parameter' });
        }

        const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:json&sheet=${encodeURIComponent(day)}`;
        
        const response = await axios.get(url, {
            headers: {
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
                'User-Agent': 'Mozilla/5.0'
            }
        });

        const textData = response.data;
        
        // Google Visualization API returns data wrapped in a JS function call:
        // /*O_o*/\ngoogle.visualization.Query.setResponse({...});
        
        // Find the JSON boundaries
        const jsonStart = textData.indexOf('{');
        const jsonEnd = textData.lastIndexOf('}') + 1;
        
        if (jsonStart === -1 || jsonEnd === 0) {
            throw new Error('Invalid response format from Google Sheets');
        }

        const jsonString = textData.substring(jsonStart, jsonEnd);
        const parsedData = JSON.parse(jsonString);

        res.json(parsedData);
    } catch (error) {
        console.error('Error fetching sheet data:', error.message);
        res.status(500).json({ error: 'Failed to fetch data from Google Sheets', details: error.message });
    }
});

// Start the server
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
