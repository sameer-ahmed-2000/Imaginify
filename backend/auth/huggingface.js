const passport = require('passport');
const OAuth2Strategy = require('passport-oauth2').Strategy;
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
require('dotenv').config();
const jwt=require('jsonwebtoken')
const HUGGINGFACE_CLIENT_ID = process.env.HUGGINGFACE_CLIENT_ID;
const HUGGINGFACE_CLIENT_SECRET = process.env.HUGGINGFACE_CLIENT_SECRET;
passport.use('huggingface', new OAuth2Strategy({
    authorizationURL: 'https://huggingface.co/oauth/authorize',
    tokenURL: 'https://huggingface.co/oauth/token',
    clientID: HUGGINGFACE_CLIENT_ID,
    clientSecret: HUGGINGFACE_CLIENT_SECRET,
    callbackURL: '/api/v1/auth/huggingface/callback',
    scope: ['openid', 'inference-api'],
    state: true,
    passReqToCallback: true,
},
async (req, accessToken, refreshToken, params, done) => {
    try {
        console.log('Received Hugging Face OAuth callback');
        console.log('Access Token:', accessToken);
        console.log('Refresh Token:', refreshToken);
        console.log('Params:', params);
        const userId = req.userId;
        if (!userId) {
            throw new Error('User ID not found');
        }
        const token=await prisma.token.upsert({
            where: { userId: userId },
            update: {
                accessToken,
                refreshToken,
                tokenExpiry: new Date(Date.now() + params.expires_in * 1000)
            },
            create: {
                userId: userId,
                accessToken,
                refreshToken,
                tokenExpiry: new Date(Date.now() + params.expires_in * 1000)
            }
        });


        return done(null, { id: token.id });
    } catch (error) {
        console.error('Error during Hugging Face OAuth callback:', error);
        return done(error);
    }
}));
passport.serializeUser((token, done) => {
    done(null, token.id);
});

passport.deserializeUser(async (id, done) => {
    try {
        const token = await prisma.token.findUnique({ where: { id } });
        done(null, token);
    } catch (error) {
        done(error);
    }
});
module.exports = passport;
