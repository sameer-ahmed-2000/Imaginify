const express = require("express");
const userRouter = require("./user");
const authRouter = require("./auth");
const imageRouter = require("./image");
const postRouter = require("./posts");

const router = express.Router();

router.use("/user", userRouter);
router.use("/auth", authRouter);
router.use("/image", imageRouter);
router.use("/post", postRouter);

module.exports = router;
