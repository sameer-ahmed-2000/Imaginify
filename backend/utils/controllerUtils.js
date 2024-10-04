const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const linkify = require('linkifyjs');
require('linkify-plugin-mention');


/**
 * Retrieves a post's comments with a specified offset using Prisma
 * @function retrieveComments
 * @param {string} postId The id of the post to retrieve comments from
 * @param {number} offset The amount of comments to skip
 * @param {number} exclude The amount of comments to exclude from the result
 * @returns {array} Array of comments with related information
 */
module.exports.retrieveComments = async (postId, offset, exclude = 0) => {
  try {
    const comments = await prisma.comment.findMany({
      where: { postId: postId },
      orderBy: { createdAt: 'asc' },
      skip: exclude + offset,
      take: 10,
      include: {
        author: {
          select: {
            id: true,
            username: true,
            avatar: true,
          },
        },
        commentReplies: {
          select: {
            id: true,
            content: true,
          },
        },
        commentVotes: {
          select: {
            votes: true,
          },
        },
      },
    });

    const commentCount = await prisma.comment.count({
      where: { postId: postId },
    });

    return {
      comments,
      commentCount,
    };
  } catch (err) {
    throw new Error(err.message);
  }
};
/**
 * Sends a notification when a user has commented on your post using Prisma
 * @function sendCommentNotification
 * @param {object} sender The user who sent the notification
 * @param {string} receiverId The ID of the user who should receive the notification
 * @param {string} postId The ID of the post that was commented on
 * @param {string} message The message that triggered the notification
 */
module.exports.sendCommentNotification = async (
  sender,
  receiverId,
  message,
  postId
) => {
  try {
    if (sender.id !== receiverId) {
      const notification = await prisma.notification.create({
        data: {
          senderId: sender.id,
          receiverId: receiverId,
          notificationType: 'comment',
          notificationData: {
            postId,
            message,
          },
        },
      });
      
      // Emit the notification via socket (using socketHandler)
      socketHandler.sendNotification({
        ...notification,
        sender: {
          id: sender.id,
          username: sender.username,
        },
      });
    }
  } catch (err) {
    throw new Error(err.message);
  }
};


/**
 * Sends a notification to the user when they are mentioned in a post
 * @function sendMentionNotification
 * @param {object} req The request object
 * @param {string} message The message where users are mentioned
 * @param {object} post The post related to the mention
 * @param {object} user The user who sent the mention
 */
module.exports.sendMentionNotification = async (req, message, image, post, user) => {
  const mentionedUsers = new Set();

  // Parse mentions in the message
  const mentions = linkify.find(message);
  for (const item of mentions) {
    if (
      item.type === 'mention' &&
      item.value !== `@${user.username}` &&
      item.value !== `@${post.author.username}` &&
      !mentionedUsers.has(item.value)
    ) {
      mentionedUsers.add(item.value);

      // Find the user being mentioned
      const receiver = await prisma.user.findUnique({
        where: { username: item.value.substring(1) }, // Removes "@" from mention
      });

      if (receiver) {
        // Create and send notification
        const notification = await prisma.notification.create({
          data: {
            senderId: user.id,
            receiverId: receiver.id,
            notificationType: 'mention',
            notificationData: {
              postId: post.id,
              image,
              message,
              filter: post.filter,
            },
          },
        });

        // Emit the notification via socket
        socketHandler.sendNotification(req, {
          ...notification,
          sender: {
            id: user.id,
            username: user.username,
            avatar: user.avatar,
          },
        });
      }
    }
  }
};
/**
 * Generates a unique username by appending a random number
 * @function generateUniqueUsername
 * @param {string} baseUsername The base username to generate a unique one
 * @returns {string} Unique username
 */
module.exports.generateUniqueUsername = async (baseUsername) => {
  let uniqueUsername;
  try {
    while (!uniqueUsername) {
      const username = `${baseUsername}${Math.floor(Math.random() * 9999) + 1}`;
      const existingUser = await prisma.user.findUnique({ where: { username } });
      
      if (!existingUser) {
        uniqueUsername = username;
      }
    }
    return uniqueUsername;
  } catch (err) {
    throw new Error(err.message);
  }
};
/**
 * Formats a cloudinary thumbnail url with a specified size
 * @function formatCloudinaryUrl
 * @param {string} url The url to format
 * @param {size} number Desired size of the image
 * @return {string} Formatted url
 */
module.exports.formatCloudinaryUrl = (url, size, thumb) => {
  const splitUrl = url.split('upload/');
  splitUrl[0] += `upload/${
    size.y && size.z ? `x_${size.x},y_${size.y},` : ''
  }w_${size.width},h_${size.height}${thumb && ',c_thumb'}/`;
  const formattedUrl = splitUrl[0] + splitUrl[1];
  return formattedUrl;
};
