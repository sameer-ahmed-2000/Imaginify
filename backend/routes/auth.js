const express = require('express');
const passport = require('passport');
require('../auth/huggingface');
const { PrismaClient } = require('@prisma/client');
const jwt = require('jsonwebtoken');
const { authMiddleware } = require('../middleware');
const prisma = new PrismaClient();

const router = express.Router();

router.get('/huggingface', passport.authenticate('huggingface'));

router.get('/huggingface/callback',authMiddleware,
    
    passport.authenticate('huggingface', { session: true, failureRedirect: '/' }),
    (req, res) => {
        res.status(200).json({ message: 'Hugging Face authentication successful', userId: req.userId });
    });

router.get('/protected', (req, res) => {
    res.json({ message: "This is a protected route." });
});


router.get("/login/success", (req, res) => {
	if (req.user) {
		res.status(200).json({
			error: false,
			message: "Successfully Logged In",
			user: req.user,
		});
	} else {
		res.status(403).json({ error: true, message: "Not Authorized" });
	}
});

router.get("/login/failed", (req, res) => {
	res.status(401).json({
		error: true,
		message: "Log in failure",
	});
});

router.get("/google", passport.authenticate("google", ["profile", "email"]));

router.get(
	"/google/callback",
	passport.authenticate("google", {
		failureRedirect: "/login/failed",
	}),
	async (req, res) => {
		const { id, displayName, emails, photos } = req.user; // Extract user info

		try {
			// Check if the user already exists
			let user = await prisma.user.findUnique({
				where: {
					email: emails[0].value,
				},
			});

			// If user does not exist, create a new one
			if (!user) {
				user = await prisma.user.create({
					data: {
						name: displayName,
						email: emails[0].value,
						avatar: photos[0].value,
						password: '', // Optional, set as needed
					},
				});
			} else {
				user = await prisma.user.update({
					where: {
						id: user.id,
					},
					data: {
						name: displayName,
						avatar: photos[0].value,
					},
				});
			}
			const token = jwt.sign(
				{ userId: user.id },
				process.env.JWT_SECRET
			);
			res.status(200).json({
				error: false,
				message: "Login successful",
				token,
				user,
			});
		} catch (error) {
			console.error(error);
			res.status(500).send("Server Error");
		}
	}
);

router.get("/logout", (req, res) => {
	req.logout();
	res.redirect(process.env.CLIENT_URL);
});


module.exports = router;
