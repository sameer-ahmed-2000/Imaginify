const nodemailer=require("nodemailer");
require('dotenv')
module.exports=async(email,subject,text)=>{
    try{
        const transporter=nodemailer.createTransport({
            host:process.env.HOST,
            service:process.env.SERVICE,
            port:Number(process.env.EMAIL_PORT),
            secure:Boolean(process.env.SECURE),
            auth:{
                user:process.env.USER,
                pass:process.env.PASS
            }
        })
        await transporter.sendMail({
            from:process.env.USER,
            to:email,
            subject:subject,
            text:text,
        });
        console.log('email sent successfully')
    }
    catch(error){
        console.log('Email not sent');
        console.log(error);
        return error;
    }
}
const nodemailer = require("nodemailer");
require('dotenv').config(); // Ensure .env is loaded

module.exports = async (email, subject, text) => {
    try {
        const transporter = nodemailer.createTransport({
            host: process.env.HOST, // SMTP host for Outlook
            port: Number(process.env.EMAIL_PORT), // Port for STARTTLS/SSL
            secure: process.env.SECURE === 'true', // Use secure for port 465 (SSL), false for port 587 (STARTTLS)
            auth: {
                user: process.env.USER, // Your Outlook email
                pass: process.env.PASS  // Your Outlook email password
            },
            tls: {
                rejectUnauthorized: false  // Allows connections even with self-signed certificates
            }
        });

        await transporter.sendMail({
            from: process.env.USER, // Your email address
            to: email, // Recipient's email address
            subject: subject, // Email subject
            text: text, // Email text content
        });

        console.log('Email sent successfully');
    } catch (error) {
        console.log('Email not sent');
        console.log(error);
        return error;
    }
};
