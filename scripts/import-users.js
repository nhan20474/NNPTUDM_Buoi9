const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const mongoose = require('mongoose');

const User = require('../schemas/users');
const Role = require('../schemas/roles');
const { sendUserPasswordMail } = require('../utils/senMailHandler');

const MONGO_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/NNPTUD-C6';
const MAIL_TIMEOUT_MS = Number(process.env.MAIL_TIMEOUT_MS || 12000);
const MAIL_ENABLED = Boolean(process.env.MAILTRAP_USER && process.env.MAILTRAP_PASS);
const MAIL_RETRY_COUNT = Number(process.env.MAIL_RETRY_COUNT || 2);
const MAIL_RETRY_DELAY_MS = Number(process.env.MAIL_RETRY_DELAY_MS || 1200);

function timeoutPromise(ms, message) {
    return new Promise((_, reject) => {
        setTimeout(() => reject(new Error(message)), ms);
    });
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function sendUserPasswordMailWithRetry(email, username, plainPassword) {
    let lastError;

    for (let attempt = 0; attempt <= MAIL_RETRY_COUNT; attempt += 1) {
        try {
            await Promise.race([
                sendUserPasswordMail(email, username, plainPassword),
                timeoutPromise(MAIL_TIMEOUT_MS, `Send mail timeout after ${MAIL_TIMEOUT_MS}ms`)
            ]);
            return;
        } catch (error) {
            lastError = error;
            const isRateLimited = /too many emails per second|\b550\b/i.test(error.message || '');
            const shouldRetry = isRateLimited && attempt < MAIL_RETRY_COUNT;

            if (!shouldRetry) {
                throw error;
            }

            await sleep(MAIL_RETRY_DELAY_MS * (attempt + 1));
        }
    }

    throw lastError;
}

function randomPassword(length = 16) {
    return crypto
        .randomBytes(length * 2)
        .toString('base64')
        .replace(/[^a-zA-Z0-9]/g, '')
        .slice(0, length);
}

function parseUsersFromFile(filePath) {
    const raw = fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '');
    const lines = raw
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);

    if (lines.length < 2) {
        throw new Error('Input file must include a header and at least 1 data row.');
    }

    const headerLine = lines[0];
    const delimiter = headerLine.includes('\t') ? '\t' : ',';
    const headers = headerLine.split(delimiter).map((h) => h.trim().toLowerCase());

    const usernameIndex = headers.indexOf('username');
    const emailIndex = headers.indexOf('email');

    if (usernameIndex === -1 || emailIndex === -1) {
        throw new Error(
            `Header must contain username and email columns. Detected header: "${headerLine}". ` +
            'Expected example: "username\temail" (TSV) or "username,email" (CSV).'
        );
    }

    return lines.slice(1).map((line, idx) => {
        const parts = line.split(delimiter).map((p) => p.trim());
        if (parts.length < 2) {
            throw new Error(`Invalid row at line ${idx + 2}: ${line}`);
        }

        return {
            username: parts[usernameIndex],
            email: parts[emailIndex]
        };
    });
}

async function getOrCreateUserRole() {
    let userRole = await Role.findOne({
        name: { $regex: /^user$/i },
        isDeleted: false
    });

    if (!userRole) {
        userRole = await Role.create({
            name: 'USER',
            description: 'Default role for imported users'
        });
        console.log('Created role USER because it did not exist.');
    }

    return userRole;
}

async function importUsers(sourceFile) {
    const absolutePath = path.resolve(sourceFile);

    if (!fs.existsSync(absolutePath)) {
        throw new Error(`File not found: ${absolutePath}`);
    }

    const users = parseUsersFromFile(absolutePath);
    const role = await getOrCreateUserRole();

    if (!MAIL_ENABLED) {
        console.log('MAILTRAP_USER or MAILTRAP_PASS is missing. Users will be imported but credential emails will be skipped.');
    }

    let createdCount = 0;
    let skippedCount = 0;
    let mailSentCount = 0;
    const failedMailUsers = [];

    for (const row of users) {
        const existingUser = await User.findOne({
            $or: [{ username: row.username }, { email: row.email }]
        });

        if (existingUser) {
            skippedCount += 1;
            console.log(`Skipped existing user/email: ${row.username} - ${row.email}`);
            continue;
        }

        const plainPassword = randomPassword(16);
        const newUser = new User({
            username: row.username,
            email: row.email,
            password: plainPassword,
            role: role._id,
            status: true
        });

        await newUser.save();
        createdCount += 1;

        if (MAIL_ENABLED) {
            try {
                await sendUserPasswordMailWithRetry(row.email, row.username, plainPassword);
                mailSentCount += 1;
                console.log(`Created and sent mail: ${row.username} - ${row.email}`);
            } catch (mailError) {
                failedMailUsers.push({
                    username: row.username,
                    email: row.email,
                    message: mailError.message
                });
                console.log(`Created user but failed to send mail: ${row.username} - ${row.email}`);
            }
        } else {
            failedMailUsers.push({
                username: row.username,
                email: row.email,
                message: 'Skipped: missing MAILTRAP_USER/MAILTRAP_PASS'
            });
        }
    }

    console.log('\n=== Import Summary ===');
    console.log(`Input users: ${users.length}`);
    console.log(`Created users: ${createdCount}`);
    console.log(`Skipped users: ${skippedCount}`);
    console.log(`Emails sent: ${mailSentCount}`);
    console.log(`Email failures: ${failedMailUsers.length}`);

    if (failedMailUsers.length > 0) {
        console.log('\nFailed email users:');
        failedMailUsers.forEach((item) => {
            console.log(`- ${item.username} (${item.email}): ${item.message}`);
        });
    }
}

async function main() {
    const sourceFile = process.argv[2] || './data/users.tsv';

    await mongoose.connect(MONGO_URI);
    console.log(`Connected DB: ${MONGO_URI}`);

    try {
        await importUsers(sourceFile);
    } finally {
        await mongoose.disconnect();
        console.log('Disconnected DB.');
    }
}

main().catch(async (error) => {
    console.error('Import failed:', error.message);
    try {
        await mongoose.disconnect();
    } catch (disconnectError) {
        // ignore disconnect errors on failure path
    }
    process.exit(1);
});
