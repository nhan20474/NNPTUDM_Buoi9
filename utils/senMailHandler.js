const nodemailer = require("nodemailer");

// Create a transporter using Ethereal test credentials.
// For production, replace with your actual SMTP server details.
const transporter = nodemailer.createTransport({
    host: process.env.MAILTRAP_HOST || "sandbox.smtp.mailtrap.io",
    port: Number(process.env.MAILTRAP_PORT || 25),
    secure: false, // Use true for port 465, false for port 587
    connectionTimeout: 5000,
    greetingTimeout: 5000,
    socketTimeout: 10000,
    auth: {
        user: process.env.MAILTRAP_USER || "",
        pass: process.env.MAILTRAP_PASS || "",
    },
});
//http://localhost:3000/api/v1/auth/resetpassword/a87edf6812f235e997c7b751422e6b2f5cd95aa994c55ebeeb931ca67214d645

// Send an email using async/await;
module.exports = {
    sendMail: async function (to,url) {
        const info = await transporter.sendMail({
            from: process.env.MAIL_FROM || 'admin@hehehe.com',
            to: to,
            subject: "reset pass",
            text: "click vo day de doi pass", // Plain-text version of the message
            html: "click vo <a href="+url+">day</a> de doi pass", // HTML version of the message
        });
    },
    sendUserPasswordMail: async function (to, username, password) {
        await transporter.sendMail({
            from: process.env.MAIL_FROM || 'admin@hehehe.com',
            to: to,
            subject: "Tai khoan moi",
            text: `Xin chao ${username}. Mat khau tam thoi cua ban la: ${password}`,
            html: `<p>Xin chao <b>${username}</b>,</p><p>Mat khau tam thoi cua ban la: <b>${password}</b></p><p>Vui long doi mat khau sau khi dang nhap.</p>`
        });
    }
}