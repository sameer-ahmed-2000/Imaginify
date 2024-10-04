const express = require('express');
const router = express.Router();
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const { authMiddleware } = require('../middleware');
const prisma = new PrismaClient();
const fs = require('fs');
const path = require('path');
const cloudinary = require('cloudinary').v2;

cloudinary.config({
    cloud_name: process.env.Cloud_name,
    api_key: process.env.API_key,
    api_secret: process.env.API_secret
});
const ADULT_KEYWORDS = [
    'nude', 'naked', 'boobs', 'breasts', 'porn', 'porno', 'explicit',
    'xxx', 'sex', 'sexual', 'erotic', 'orgasm', 'fetish', 'kinky',
    'bdsm', 'bondage', 's&m', 'dominatrix', 'strip', 'stripper',
    'striptease', 'erotica', 'adult', 'hardcore', 'softcore', 'r18',
    'blowjob', 'handjob', 'deepthroat', 'threesome', 'foursome',
    'gangbang', 'cum', 'ejaculate', 'ejaculation', 'masturbate',
    'masturbation', 'dildo', 'vibrator', 'anal', 'butt', 'buttocks',
    'ass', 'booty', 'vagina', 'penis', 'clitoris', 'vulva', 'testicles',
    'scrotum', 'genitalia', 'cunnilingus', 'fellatio', '69', 'orgy',
    'voyeur', 'voyeurism', 'peep', 'peeping', 'prostitute',
    'prostitution', 'escort', 'camgirl', 'camwhore', 'hooker', 'whore',
    'slut', 'incest', 'taboo', 'milf', 'cougar', 'hentai', 'yaoi',
    'yuri', 'incest', 'bestiality', 'beastiality', 'zoophilia',
    'necrophilia', 'rape', 'molest', 'molestation', 'pedophilia',
    'underage', 'childporn', 'lolita', 'teen', 'barely legal',
    'amateur', 'lesbian', 'gay', 'homosexual', 'bisexual', 'transsexual',
    'transgender', 'crossdress', 'shemale', 'ladyboy', 'tranny',
    'bukkake', 'gangbang', 'pegging', 'fisting', 'rimming', 'tits',
    'cock', 'dick', 'pussy', 'clit', 'piss', 'urinate', 'pee', 'scat',
    'feces', 'shit', 'smut'
];


router.post('/generate-image', authMiddleware, async (req, res) => {
    try {
        const { default: fetch } = await import('node-fetch');
        const userId = req.userId;
        const { inputs } = req.body;
        const isAdultContent = ADULT_KEYWORDS.some(keyword =>
            inputs.toLowerCase().includes(keyword)
        );
        const tokenRecord = await prisma.token.findUnique({
            where: { userId },
        });

        if (!tokenRecord || !tokenRecord.accessToken) {
            throw new Error('Access token not found for user');
        }
        const response = await fetch('https://api-inference.huggingface.co/models/black-forest-labs/FLUX.1-dev', {
            headers: {
                Authorization: `Bearer ${tokenRecord.accessToken}`,
                'Content-Type': 'application/json',
            },
            method: 'POST',
            body: JSON.stringify({ inputs }),
        });

        if (response.ok) {
            const buffer = await response.buffer();
            const tempImagePath = path.join(__dirname, 'temp_image.png');
            fs.writeFileSync(tempImagePath, buffer);
            const cloudinaryResponse = await cloudinary.uploader.upload(tempImagePath, {
                folder: 'generated_images'
            });
            fs.unlinkSync(tempImagePath);
            const savedImage = await prisma.generatedImage.create({
                data: {
                    image: cloudinaryResponse.secure_url,
                    prompt: inputs,
                    userId,
                    isAdultContent,
                },
            });
            res.status(200).json({ success: true, imageId: savedImage.id });
        } else {
            const errorText = await response.text();
            console.error(`Error fetching image: ${response.status} ${response.statusText}`);
            console.error(`Error details: ${errorText}`);
            res.status(response.status).json({ error: errorText });
        }
    } catch (error) {
        console.error('Error generating image:', error);
        res.status(500).json({ message: 'Internal Server Error' });
    }
});

router.get('/generated-image/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const generatedImage = await prisma.generatedImage.findUnique({
            where: {
                id: id,
            },
            include: {
                post: true,
                user: {
                    select: {
                        name: true,
                        username:true,
                        email: true
                    }
                }
            },
        });

        if (!generatedImage) {
            return res.status(404).json({ error: "Generated image not found" });
        }

        res.status(200).json(generatedImage);
    } catch (error) {
        console.error("Error fetching the generated image:", error);
        res.status(500).json({ error: "Something went wrong" });
    }
});
module.exports = router;

