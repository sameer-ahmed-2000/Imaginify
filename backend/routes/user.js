const express = require('express');
const router = express.Router();
const zod = require("zod");
require('dotenv').config();
const jwt = require("jsonwebtoken");
const bcrypt = require('bcrypt');
const { PrismaClient } = require('@prisma/client');
const { authMiddleware } = require('../middleware');
const JWT_SECRET = process.env.JWT_SECRET;
const prisma = new PrismaClient();
const { validateEmail, validateFullName, validateUsername, validatePassword } = require('../utils/validation');
const socket = require('../socket')
const email=require("../utils/email")
const crypto = require("crypto");
const signupSchema = zod.object({
    name: zod.string().min(2, "Name is required"),
    email: zod.string().email("Invalid email"),
    username: zod.string().min(4, "Invalid username"),
    password: zod.string().min(6, "Password must be at least 6 characters"),
    dob: zod.string().refine((val) => !isNaN(Date.parse(val)), {
        message: "Invalid date format. Expected YYYY-MM-DD",
    })
});


async function hashPassword(password) {
    return bcrypt.hash(password, 10);
}


router.post('/signup', async (req, res) => {
    try {
        const body = req.body;
        const emailError = validateEmail(body.email);
        if (emailError) {
            return res.status(400).json({ message: emailError });
        }

        // Validate full name
        const nameError = validateFullName(body.name);
        if (nameError) {
            return res.status(400).json({ message: nameError });
        }

        // Validate username
        const usernameError = validateUsername(body.username);
        if (usernameError) {
            return res.status(400).json({ message: usernameError });
        }

        // Validate password
        const passwordError = validatePassword(body.password);
        if (passwordError) {
            return res.status(400).json({ message: passwordError });
        }
        const validation = signupSchema.safeParse(body);
        if (!validation.success) {
            return res.status(400).json({
                message: "Incorrect inputs",
                errors: validation.error.issues
            });
        }

        const existingUser = await prisma.user.findFirst({
            where: { email: body.email }
        });
        if (existingUser) {
            return res.status(409).json({
                message: "Email is already taken"
            });
        }
        const parsedDob = new Date(body.dob);
        if (isNaN(parsedDob)) {
            return res.status(400).json({
                message: "Invalid date of birth format"
            });
        }
        const hashedPassword = await hashPassword(body.password);
        const user = await prisma.user.create({
            data: {
                name: body.name,
                email: body.email,
                username: body.username,
                password: hashedPassword,
                dob: parsedDob,
                verified: false
            }
        });
        const verificationToken = crypto.randomBytes(32).toString('hex');
        await prisma.verifyToken.create({
            data: {
                userId: user.id,
                token: verificationToken
            }
        });
        const token = jwt.sign({ userId: user.id }, JWT_SECRET);
        // Send verification email
        const verificationUrl = `${process.env.BASE_URL}/verify/${user.id}/${verificationToken}`;
        await email(user.email, "Email Verification", `Please verify your email using the following link: ${verificationUrl}`);

        return res.json({
            userId: user.id,
            token,
            message: "User registered successfully, please verify your email."
        });

    } catch (error) {
        return res.status(500).json({
            message: 'Internal server error',
            error: error.message
        });
    } finally {
        await prisma.$disconnect();
    }
});

const signinSchema = zod.object({
    email: zod.string().email(),
    password: zod.string(),
});

async function verifyPassword(plainPassword, hashedPassword) {
    return bcrypt.compare(plainPassword, hashedPassword);
}

router.post('/signin', async (req, res) => {
    try {
        const body = req.body;
        const validation = signinSchema.safeParse(body);
        if (!validation.success) {
            return res.status(400).json({
                message: "Incorrect inputs",
                errors: validation.error.issues
            });
        }

        const user = await prisma.user.findFirst({
            where: { email: body.email }
        });

        if (!user || !(await verifyPassword(body.password, user.password))) {
            return res.status(401).json({
                message: "Invalid Email or Password"
            });
        }

        const token = jwt.sign({ userId: user.id }, JWT_SECRET);
        return res.json({ userId: user.id, token });

    } catch (error) {
        return res.status(500).json({
            message: 'Internal server error',
            error: error.message
        });
    } finally {
        await prisma.$disconnect();
    }
});
router.put('/update', authMiddleware, async (req, res) => {
    try {
        const userId = req.userId;
        const { dob, username,avatar } = req.body;

        if (!dob) {
            return res.status(400).json({ message: "Date of Birth is required" });
        }
        if (!username || username.trim().length === 0) {
            return res.status(400).json({ message: "Username is required" });
        }
        const usernameError = validateUsername(body.username);
        if (usernameError) {
            return res.status(400).json({ message: usernameError });
        }
        const updatedUser = await prisma.user.update({
            where: { id: userId },
            data: {
                dob: new Date(dob),
                username: username.trim(),
                avatar
            },
            select: { id: true, dob: true, username: true }
        });

        res.status(200).json(updatedUser);
    } catch (error) {
        if (error.code === 'P2002') {
            return res.status(409).json({ message: 'Username is already taken' });
        }

        console.error("Error updating user:", error);
        res.status(500).json({ message: 'Internal server error' });
    }
});
router.get('/verify/:userId/:token', async (req, res) => {
    try {
        const { userId, token } = req.params;
        const verifyToken = await prisma.verifyToken.findFirst({
            where: {
                userId,
                token
            }
        });

        if (!verifyToken) {
            return res.status(400).json({ message: "Invalid or expired token" });
        }
        await prisma.user.update({
            where: { id: userId },
            data: { verified: true }
        });
        await prisma.verifyToken.delete({
            where: { id: verifyToken.id }
        });

        return res.json({ message: "Email verified successfully" });
    } catch (error) {
        return res.status(500).json({
            message: 'Internal server error',
            error: error.message
        });
    } finally {
        await prisma.$disconnect();
    }
});
router.post('/follow/:id', authMiddleware, async (req, res) => {
    const { id: userToFollowId } = req.params;
    const userId = req.userId;

    try {
        const userToFollow = await prisma.user.findUnique({
            where: { id: userToFollowId },
        });

        if (!userToFollow) {
            return res.status(400).send({ error: 'User not found.' });
        }
        const isFollowing = await prisma.following.findFirst({
            where: {
                userId,
                followingId: userToFollowId,
            },
        });
        const currentUser = await prisma.user.findUnique({
            where: { id: userId },
            select: { id: true, username: true,avatar:true }, // Include avatar if needed
        });

        if (isFollowing) {
            await prisma.following.delete({
                where: {
                    userId_followingId: {
                        userId,
                        followingId: userToFollowId,
                    },
                },
            });

            await prisma.follower.delete({
                where: {
                    userId_followerId: {
                        userId: userToFollowId,
                        followerId: userId,
                    },
                },
            });

            return res.send({ success: true, operation: 'unfollow' });
        } else {
            await prisma.following.create({
                data: {
                    userId,
                    followingId: userToFollowId,
                },
            });

            await prisma.follower.create({
                data: {
                    userId: userToFollowId,
                    followerId: userId,
                },
            });

            const notification = await prisma.notification.create({
                data: {
                    notificationType: 'follow',
                    senderId: userId, 
                    receiverId: userToFollowId,
                    date: new Date(),
                    notificationData: { message: `${currentUser.username} has started following you.` , avatar:currentUser.avatar, id:currentUser.id},  // Use current user's username
                    read: false,
                },
            });

            console.log("Attempting to emit follow notification...");
            socket.getIO().to(userToFollowId).emit('notification',notification)
            console.log(notification)
            console.log("Follow notification emitted.");
            return res.send({ success: true, operation: 'follow' });
        }
    } catch (error) {
        console.error("Error handling follow/unfollow operation:", error);
        return res.status(500).json({ message: "Internal server error", error });
    }
});

router.get('/myprofile', authMiddleware, async (req, res) => {
    try {
        const userId = req.userId;
        const userProfilePromise = prisma.user.findUnique({
            where: { id: userId },
            select: {
                name: true,
                posts: {
                    select: {
                        id: true,
                        caption: true,
                        createdAt: true,
                        image: true
                    },
                },
                generatedImages: true,
            },
        });

        const followerAndFollowingPromise = prisma.user.findUnique({
            where: { id: userId },
            select: {
                _count: {
                    select: {
                        Follower: true,
                        Following: true
                    }
                },
                Follower: {
                    select: {
                        follower: {
                            select: {
                                id: true,
                                name: true
                            }
                        }
                    }
                },
                Following: {
                    select: {
                        following: {
                            select: {
                                id: true,
                                name: true
                            }
                        }
                    }
                }
            },
        });

        const [userProfile, followerAndFollowing] = await Promise.all([
            userProfilePromise,
            followerAndFollowingPromise,
        ]);

        if (!userProfile) {
            return res.status(404).json({ error: 'User not found' });
        }

        const followersCount = followerAndFollowing._count.Follower;
        const followingCount = followerAndFollowing._count.Following;

        const followingIds = followerAndFollowing.Following.map(f => f.following.id);

        res.status(200).json({
            name: userProfile.name,
            followersCount,
            followingCount,
            followers: followerAndFollowing.Follower.map(f => ({
                id: f.follower.id,
                name: f.follower.name,
                isFollowing: followingIds.includes(f.follower.id),
            })),
            following: followerAndFollowing.Following.map(f => ({
                id: f.following.id,
                name: f.following.name,
            })),
            numOfPosts: userProfile.posts.length,
            posts: userProfile.posts,
            generatedImages: userProfile.generatedImages,
        });
    } catch (error) {
        console.error('Error retrieving profile:', error);
        res.status(500).json({ error: 'Something went wrong' });
    } finally {
        await prisma.$disconnect();
    }
});

router.get('/:id/profile', authMiddleware, async (req, res) => {
    try {
        const { id } = req.params;

        const userProfile = await prisma.user.findUnique({
            where: { id },
            select: {
                name: true,
                followers: {
                    select: {
                        followerId: true,
                    },
                },
                following: {
                    select: {
                        followingId: true,
                    },
                },
                posts: {
                    select: {
                        id: true,
                        caption: true,
                        createdAt: true,
                        generatedImages: true,
                    },
                }
            }

        });

        if (!userProfile) {
            return res.status(404).json({ error: 'User not found' });
        }
        const numOfPosts = userProfile.posts.length;

        const followersCount = userProfile.followers.length;
        const followingCount = userProfile.following.length;
        res.status(200).json({
            name: userProfile.name,
            followersCount,
            followingCount,
            followers: userProfile.followers.map(f => f.followerId),
            following: userProfile.following.map(f => f.followingId),
            numOfPosts,
            posts: userProfile.posts,
            generatedImages: userProfile.generatedImages,
        });
    } catch (error) {
        console.error('Error retrieving user profile:', error);
        res.status(500).json({ error: 'Something went wrong' });
    } finally {
        await prisma.$disconnect();
    }
});

module.exports = router;