const express = require('express');
const router = express.Router();
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const { authMiddleware } = require('../middleware');
const { formatCloudinaryUrl } = require('../utils/controllerUtils');
const prisma = new PrismaClient();
const linkify = require('linkifyjs');
const socket = require('../socket')
router.use(authMiddleware);

// Create a new post post
router.post('/posts', async (req, res) => {
    try {
        const { caption, generatedImageId } = req.body;
        const {userId} = req;
        const generatedImage = await prisma.generatedImage.findUnique({
            where: {
                id: generatedImageId,
            },
        });

        if (!generatedImage || generatedImage.userId !== userId) {
            return res.status(404).json({ error: 'Generated image not found or not owned by the user' });
        }
        const post = await prisma.post.create({
            data: {
                caption,
                userId,
                generatedImageId,
                image: generatedImage.image,
                generatedImages: {
                    connect: { id: generatedImageId }
                }
            }
        });
        await prisma.generatedImage.update({
            where: {
                id: generatedImageId,
            },
            data: {
                postId: post.id,
            },
        });

        res.status(201).json(post);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Something went wrong' });
    }
});

router.get('/posts/myposts', async (req, res) => {
    try {
        const { userId } = req;

        if (!userId) {
            return res.status(400).json({ error: 'User ID is required' });
        }
        const posts = await prisma.post.findMany({
            where: { userId },
            include: {
                user: {
                    select: {
                        id: true,
                        username: true,
                        avatar: true
                    }
                },
                generatedImages: true,
                comments: {
                    select: {
                        id: true
                    }
                },
                likes: {
                    select: {
                        id: true, user:{
                            select:{
                                username:true
                            }
                        }
                    }
                },
                comments: {
                    include: {
                        replies: {
                            select: {
                                id: true
                            }
                        }
                    }
                }
            },
            orderBy: { createdAt: 'desc' }
        });

        if (!posts || posts.length === 0) {
            return res.status(404).json({ message: 'No posts found for this user' });
        }
        const postsWithCounts = posts.map(post => {
            const commentsCount = post.comments.length;
            const likesCount = post.likes.length;
            const repliesCount = post.comments.reduce((acc, comment) => acc + comment.replies.length, 0);
            const totalComments = commentsCount + repliesCount;
            return {
                ...post,
                _count: {
                    comments: totalComments,
                    likes: likesCount,
                }
            };
        });

        res.status(200).json(postsWithCounts);
    } catch (error) {
        console.error('Error fetching posts:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

router.get('/posts/:postId', async (req, res) => {
    const { postId } = req.params;

    try {
        const post = await prisma.post.findUnique({
            where: { id: postId },
            include: {
                user: {
                    select: {
                        id: true,
                        name: true,
                        username: true,
                        avatar: true
                    }
                },
                generatedImages: true,
                comments: {
                    include: {
                        author: {
                            select: {
                                id: true,
                                name: true,
                                username: true,
                                avatar: true
                            }
                        },
                        likes: true,
                        replies: {
                            include: {
                                author: {
                                    select: {
                                        id: true,
                                        name: true,
                                        username: true,
                                        avatar: true
                                    }
                                },
                                likes: true
                            }
                        }
                    }
                },
                likes: {
                    include: {
                        user: {
                            select: {
                                id: true,
                                name: true,
                                username: true,
                                avatar: true
                            }
                        }
                    }
                }
            }
        });

        if (!post) {
            return res.status(404).json({ message: "Post not found" });
        }

        res.status(200).json(post);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Internal server error' });
    }
});
router.get('/feed', authMiddleware, async (req, res) => {
    const { cursor, limit = 10 } = req.query;

    try {
        const followingList = await prisma.following.findMany({
            where: { userId: req.userId },
            select: { followingId: true },
        });

        if (!followingList.length) {
            return res.status(404).json({ message: 'No following users found' });
        }

        const followingIds = followingList.map(f => f.followingId);

        const posts = await prisma.post.findMany({
            where: { userId: { in: followingIds } },
            select: {
                id: true,
                caption: true,
                createdAt: true,
                user: { 
                    select: { id: true, name: true, avatar: true },
                },
                likes: {
                    select: {
                        userId: true, 
                    },
                },
            },
            take: parseInt(limit),
            skip: cursor ? 1 : 0,
            cursor: cursor ? { id: cursor } : undefined,
            orderBy: { createdAt: 'desc' },
        });
        if (!posts.length) {
            return res.status(404).json({ message: 'No posts found' });
        }
        const nextCursor = posts.length === parseInt(limit) ? posts[posts.length - 1].id : null;
        res.status(200).json({ 
            posts: posts.map(post => ({
                ...post,
                likeCount: post.likes.length 
            })), 
            nextCursor 
        });
    } catch (error) {
        console.error('Error retrieving feed:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// Fetch the details of users who liked a specific post
router.get('/posts/:postId/likes', async (req, res) => {
    const { postId } = req.params;

    try {
        const post = await prisma.post.findUnique({
            where: { id: postId },
            include: {
                likes: {
                    include: {
                        user: {
                            select: {
                                id: true,
                                name: true,
                                username: true,
                                avatar: true
                            }
                        }
                    }
                }
            }
        });

        if (!post) {
            return res.status(404).json({ message: 'Post not found' });
        }

        const likedUsers = post.likes.map(like => like.user);

        res.status(200).json({ likedUsers });
    } catch (error) {
        console.error('Error retrieving likes:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
});

router.get('/posts/:postId/comments', async (req, res) => {
    const { postId } = req.params;
    const { cursor, limit = 10 } = req.query;

    try {
        const post = await prisma.post.findUnique({
            where: { id: postId },
            select: {
                id: true,
                comments: {
                    take: parseInt(limit),
                    skip: cursor ? 1 : 0,
                    cursor: cursor ? { id: cursor } : undefined,
                    include: {
                        author: { 
                            select: { id: true, name: true, username: true, avatar: true } 
                        },
                        replies: {
                            take: 3, // Limit the number of replies shown initially
                            include: {
                                author: { 
                                    select: { id: true, name: true, username: true, avatar: true } 
                                }
                            }
                        },
                        _count: {
                            select: { replies: true }
                        }
                    }
                }
            }
        });

        if (!post) {
            return res.status(404).json({ message: 'Post not found' });
        }

        const nextCursor = post.comments.length === parseInt(limit) ? post.comments[post.comments.length - 1].id : null;

        const totalComments = post.comments.reduce((count, comment) => count + 1 + comment._count.replies, 0);

        res.status(200).json({ comments: post.comments, totalComments, nextCursor });
    } catch (error) {
        console.error('Error retrieving comments:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
});


// Delete a post post
router.delete('/post/:id', async (req, res) => {
    const {postId} = req.params.id;
    const {userId} = req;

    try {
        // Check if the post exists and belongs to the user
        const post = await prisma.post.findUnique({
            where: {
                id: postId,
            },
            include: {
                user: true,
            },
        });

        if (!post) {
            return res.status(404).json({ message: 'Post not found' });
        }

        if (post.userId !== userId) {
            return res.status(403).json({ message: 'Unauthorized to delete this post' });
        }
        await prisma.post.delete({
            where: {
                id: postId,
            },
        });
        if (post.generatedImagesId) {
            await prisma.generatedImage.update({
                where: {
                    id: post.generatedImagesId,
                },
                data: {
                    postId: null,
                },
            });
        }
        res.status(200).json({ message: 'Post deleted successfully' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    }
});
router.post('/:postId/comments', async (req, res) => {
    const { postId } = req.params;
    const { message } = req.body;
    const { userId } = req;

    if (!message) {
        return res.status(400).send({ error: 'Please provide a message with your comment.' });
    }

    try {
        const [post, currentUser] = await Promise.all([
            prisma.post.findUnique({
                where: { id: postId },
                select: { id: true, userId: true, image: true }
            }),
            prisma.user.findUnique({
                where: { id: userId },
                select: { id: true, username: true, avatar: true }
            })
        ]);

        if (!post) {
            return res.status(404).send({ error: 'Post not found.' });
        }

        const comment = await prisma.comment.create({
            data: {
                message,
                authorId: userId,
                postId,
            },
            include: {
                author: true,
            },
        });

        const mentionedUsernames = linkify.find(message)
            .filter(item => item.type === 'mention')
            .map(item => item.value.split('@')[1]);

        const mentionedUsers = await prisma.user.findMany({
            where: { username: { in: mentionedUsernames } },
            select: { id: true, username: true, avatar: true }
        });

        const notificationPromises = mentionedUsers.map(async (mentionedUser) => {
            if (String(mentionedUser.id) !== String(userId)) {
                const notification = await prisma.notification.create({
                    data: {
                        senderId: userId,
                        receiverId: mentionedUser.id,
                        notificationType: 'mention',
                        date: new Date(),
                        postId: post.id,
                        notificationData: {
                            message: `${currentUser.username} mentioned you in a comment: ${message}`,
                            avatar: currentUser.avatar,
                            image: post.image,
                        },
                        read: false,
                    },
                });
                console.log("Attempting to emit mention notification...");
                socket.getIO().to(mentionedUser.id).emit('notification', notification);
            }
        });

        if (String(post.userId) !== String(userId)) {
            const commentNotification = await prisma.notification.create({
                data: {
                    senderId: userId,
                    receiverId: post.userId,
                    notificationType: 'comment',
                    date: new Date(),
                    postId: post.id,
                    notificationData: {
                        message: `${currentUser.username} commented on your post: ${message}`,
                        avatar: currentUser.avatar,
                        image: post.image,
                    },
                    read: false,
                },
            });
            console.log("Attempting to emit comment notification to post owner...");
            socket.getIO().to(post.userId).emit('notification', commentNotification);
        }
        await Promise.all(notificationPromises);

        res.status(201).send({ ...comment, author: { userId }, commentVotes: [] });

    } catch (error) {
        console.error("Error creating comment:", error);
        res.status(500).json({ message: "Internal server error" });
    }
});

// Update a comment
router.put('/comments/:commentId', async (req, res) => {
    try {
        const { commentId } = req.params;
        const { content } = req.body;
        const { userId } = req;

        const updatedComment = await prisma.comment.updateMany({
            where: {
                id: commentId,
                authorId: userId,
            },
            data: { content },
        });

        if (updatedComment.count === 0) {
            return res.status(404).json({ error: "Comment not found or not authorized" });
        }

        res.status(200).json({ message: "Comment updated successfully", updatedComment });
    } catch (error) {
        console.error("Error updating comment:", error);
        res.status(500).json({ message: "Internal server error" });
    }
});

// Delete a comment
router.delete('/comments/:commentId', async (req, res) => {
    try {
        const { commentId } = req.params;
        const { userId } = req;
        const collectReplies = async (commentId) => {
            const replies = await prisma.commentReply.findMany({
                where: {
                    parentCommentId: commentId
                },
                select: {
                    id: true
                }
            });
            for (const reply of replies) {
                const nestedReplies = await collectReplies(reply.id);
                replies.push(...nestedReplies);
            }

            return replies;
        };

        const allReplies = await collectReplies(commentId);

        const replyIds = allReplies.map(reply => reply.id);

        if (replyIds.length > 0) {
            await prisma.commentReply.deleteMany({
                where: {
                    id: { in: replyIds }
                }
            });
        }

        const deletedComment = await prisma.comment.deleteMany({
            where: {
                id: commentId,
                authorId: userId
            }
        });

        if (deletedComment.count === 0) {
            return res.status(404).json({ error: "Comment not found or not authorized" });
        }

        res.status(200).json({ message: "Comment and all related replies deleted successfully" });
    } catch (error) {
        console.error("Error deleting comment and its replies:", error);
        res.status(500).json({ message: "Internal server error" });
    }
});



// Like a  comment
router.post('/likes/comment/:commentId', async (req, res) => {
    try {
        const { commentId } = req.params;
        const { userId } = req;
        const [comment, currentUser] = await Promise.all([
            prisma.comment.findUnique({
                where: {
                    id: commentId
                },
                select: {
                    id: true,
                    message: true,
                    author: {
                        select: {
                            id: true,
                            username: true,
                        }
                    },
                    post: {
                        select: {
                            id: true,
                            image: true
                        }
                    }
                }
            }),
            prisma.user.findUnique({
                where: { id: userId },
                select: { id: true, username: true, avatar: true }
            })
        ]);
        const like = await prisma.commentLike.findFirst({
            where: {
                commentId: commentId,
                userId: userId,
            },
            select: {
                id: true,
            },
        });

        if (like) {
            await prisma.commentLike.delete({
                where: {
                    id: like.id,
                },
            });
            return res.send({ success: true, message: 'Comment unliked' });
        } else {
            await prisma.commentLike.create({
                data: {
                    commentId: commentId,
                    userId: userId,
                },
            });
            const notification = await prisma.notification.create({
                data: {
                    notificationType: 'like',
                    senderId: userId,
                    receiverId: comment.author.id,
                    date: new Date(),
                    notificationData: { message: `${currentUser.username} liked your comment: ${comment.message}`, avatar: currentUser.avatar, image: comment.post.image },
                    read: false
                }
            })
            const io = req.io;
            console.log("Attempting to emit like notification...");
            io.to(comment.authorId).emit('notification', notification);
            console.log(notification);
            console.log("Like notification emitted.")
            return res.send({ success: true, message: 'Comment liked' });
        }
    } catch (error) {
        console.error('Error fetching likes:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
});
// Like a post
router.post('/likes/post/:postId', async (req, res) => {
    try {
        const { postId } = req.params;
        const { userId } = req;
        const currentUser = await prisma.user.findUnique({
            where: { id: userId },
            select: { id: true, username: true, avatar: true }, // Include avatar if needed
        });
        const post = await prisma.post.findUnique({
            where: {
                id: postId
            },
            select: {
                id: true, image: true, userId: true
            }
        })
        const like = await prisma.postLike.findFirst({
            where: {
                postId: postId,
                userId: userId,
            },
            select: {
                id: true,
            },
        });

        if (like) {
            await prisma.postLike.delete({
                where: {
                    id: like.id,
                },
            });
            return res.send({ success: true, message: 'Comment unliked' });
        } else {
            await prisma.postLike.create({
                data: {
                    postId: postId,
                    userId: userId,
                },
            });

            const notification = await prisma.notification.create({
                data: {
                    notificationType: 'like',
                    senderId: currentUser.id,
                    receiverId: post.userId,
                    date: new Date(),
                    notificationData: { message: `${currentUser.username} liked your post`, avatar: currentUser.avatar, image: post.image },
                    read: false
                }
            })
            console.log('Initiating emit');
            socket.getIO().to(reply.author.id).emit('notification', notification)
            console.log('Emit successfull')
            return res.send({ success: true, message: 'Comment liked' });
        }
    } catch (error) {
        console.error('Error fetching likes:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// Like a reply
router.post('/likes/reply/:replyId', async (req, res) => {
    try {
        const { replyId } = req.params;
        const { userId } = req;
        const [reply, currentUser] = await Promise.all([
            prisma.commentReply.findUnique({
                where: {
                    id: replyId,
                },
                select: {
                    id: true,
                    message: true,
                    parentCommentId: true,
                    author: {
                        select: {
                            id: true,
                            username: true,
                            avatar: true,
                        },
                    },
                    parentComment: {
                        select: {
                            id: true,
                            message: true,
                            author: {
                                select: {
                                    id: true,
                                    username: true,
                                    avatar: true,
                                },
                            },
                            post: {
                                select: {
                                    id: true,
                                    image: true,
                                    userId: true, // Post owner's ID
                                },
                            },
                        },
                    },
                },
            }),
            prisma.user.findUnique({
                where: { id: userId },
                select: { id: true, username: true, avatar: true }
            })
        ])
        const like = await prisma.commentReplyLike.findFirst({
            where: {
                commentReplyId: replyId,
                userId: userId
            },
            select: {
                id: true
            }
        });
        if (like) {
            await prisma.commentReplyLike.delete({
                where: {
                    id: like.id
                }
            });
            return res.send({ success: true, message: 'Reply unliked' });
        } else {
            await prisma.commentReplyLike.create({
                data: {
                    commentReplyId: replyId,
                    userId: userId
                }
            });
            const notification = await prisma.notification.create({
                data: {
                    notificationType: 'like',
                    senderId: currentUser.id,
                    receiverId: reply.author.id,
                    date: new Date(),
                    notificationData: { message: `${currentUser.username} liked your comment`, avatar: currentUser.avatar, image: reply.parentComment.post.image },
                    read: false
                }
            })
            console.log('Initiating emit');
            socket.getIO().to(reply.author.id).emit('notification', notification)
            console.log('Emit successfull')
            return res.send({ success: true, message: 'Reply liked' });
        }
    } catch (error) {
        res.status(500).json({ message: "Internal server error" });
    }
})


// Get likes for a comment
router.get('/likes/comment/:commentId', async (req, res) => {
    try {
        const { commentId } = req.params;

        const likes = await prisma.like.findMany({
            where: { commentId },
            include: {
                user: { select: { name: true } },
            },
        });

        res.status(200).json({ likes });
    } catch (error) {
        console.error("Error fetching likes:", error);
        res.status(500).json({ message: "Internal server error" });
    }
});
router.post('/reply/:commentId', async (req, res) => {
    try {
        const { commentId } = req.params;
        const { userId } = req;
        const { message } = req.body;

        if (!message) {
            return res.status(400).send({ error: 'Please provide a message' });
        }

        if (!commentId) {
            return res.status(400).send({ error: 'Please provide the comment id' });
        }

        const replyToReply = await prisma.commentReply.findUnique({
            where: { id: commentId },
            select: {
                id: true,
                parentCommentId: true,
                author: { select: { id: true, username: true } }
            }
        });

        let comment, parentCommentId;

        if (replyToReply) {
            comment = await prisma.comment.findUnique({
                where: { id: replyToReply.parentCommentId },
                select: { postId: true }
            });

            parentCommentId = replyToReply.parentCommentId;
        } 
        else {
            comment = await prisma.comment.findUnique({
                where: { id: commentId },
                select: {
                    id: true,
                    postId: true,
                    author: { select: { id: true, username: true } }
                }
            });

            if (!comment) {
                return res.status(404).send({ error: 'Comment not found' });
            }

            parentCommentId = commentId;
        }

        const [post, currentUser] = await Promise.all([
            prisma.post.findUnique({
                where: { id: comment.postId },
                select: { id: true, userId: true, image: true }
            }),
            prisma.user.findUnique({
                where: { id: userId },
                select: { id: true, username: true, avatar: true }
            })
        ]);

        const commentAuthor = replyToReply ? replyToReply.author.username : comment.author.username;
        const replyContent = `@${commentAuthor} ${message}`;


        await prisma.commentReply.create({
            data: {
                message: replyContent,
                authorId: userId,
                parentCommentId
            }
        });

        const notificationPromises = [];

        const originalAuthorId = replyToReply ? replyToReply.author.id : comment.author.id;

        if (originalAuthorId !== userId) {
            const notification = prisma.notification.create({
                data: {
                    senderId: userId,
                    receiverId: originalAuthorId,
                    notificationType: 'reply',
                    date: new Date(),
                    postId: post.id,
                    notificationData: {
                        message: `${currentUser.username} replied: ${replyContent}`,
                        image: post.image,
                        avatar: currentUser.avatar
                    },
                    read: false
                }
            });

            notificationPromises.push(notification);
            socket.getIO().to(originalAuthorId).emit('notification', notification);
        }

        if (post.userId !== originalAuthorId && post.userId !== userId) {
            const notification = prisma.notification.create({
                data: {
                    senderId: userId,
                    receiverId: post.userId,
                    notificationType: 'comment',
                    date: new Date(),
                    postId: post.id,
                    notificationData: {
                        message: `${currentUser.username} commented on your post: ${message}`,
                        image: post.image,
                        avatar: currentUser.avatar
                    },
                    read: false
                }
            });

            notificationPromises.push(notification);
            socket.getIO().to(post.userId).emit('notification', notification);
        }

        await Promise.all(notificationPromises);

        res.status(201).send({ message: 'Reply created successfully and notifications sent.' });

    } catch (error) {
        console.error("Error creating reply:", error);
        res.status(500).send({ error: 'Internal server error' });
    }
});
router.delete('/replies/:replyId', async (req, res) => {
    try {
        const { replyId } = req.params;
        const { userId } = req;

        const collectNestedReplies = async (replyId) => {
            const nestedReplies = await prisma.commentReply.findMany({
                where: {
                    parentCommentId: replyId
                },
                select: {
                    id: true
                }
            });

            for (const reply of nestedReplies) {
                const repliesOfReply = await collectNestedReplies(reply.id);
                nestedReplies.push(...repliesOfReply);
            }

            return nestedReplies;
        };

        const allNestedReplies = await collectNestedReplies(replyId);

        const nestedReplyIds = allNestedReplies.map(reply => reply.id);

        if (nestedReplyIds.length > 0) {
            await prisma.commentReply.deleteMany({
                where: {
                    id: { in: nestedReplyIds }
                }
            });
        }

        const deletedReply = await prisma.commentReply.deleteMany({
            where: {
                id: replyId,
                authorId: userId
            }
        });

        if (deletedReply.count === 0) {
            return res.status(404).json({ error: "Reply not found or not authorized" });
        }

        res.status(200).json({ message: "Reply and all nested replies deleted successfully" });
    } catch (error) {
        console.error("Error deleting reply and its nested replies:", error);
        res.status(500).json({ message: "Internal server error" });
    }
});

module.exports = router