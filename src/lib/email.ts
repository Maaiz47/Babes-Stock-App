import nodemailer from 'nodemailer';

function getTransporter() {
  return nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.GMAIL_USER,
      pass: process.env.GMAIL_APP_PASSWORD,
    },
  });
}

export async function sendEmailVerificationCode(newEmail: string, username: string, code: string) {
  const transporter = getTransporter();
  await transporter.sendMail({
    from: `"Babes Stock" <${process.env.GMAIL_USER}>`,
    to: newEmail,
    subject: `${code} — verify your new email`,
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto">
        <h2 style="color:#7c3aed">Verify your new email</h2>
        <p>Hi ${username},</p>
        <p>Enter this code in the app to confirm your new email address. It expires in <strong>15 minutes</strong>.</p>
        <div style="font-size:36px;font-weight:700;letter-spacing:8px;color:#7c3aed;margin:24px 0;font-family:monospace">${code}</div>
        <p style="color:#6b7280;font-size:13px">If you didn't request this, ignore this email.</p>
      </div>
    `,
  });
}

export async function sendEmailChangeNotification(oldEmail: string, username: string, newEmail: string) {
  const transporter = getTransporter();
  await transporter.sendMail({
    from: `"Babes Stock" <${process.env.GMAIL_USER}>`,
    to: oldEmail,
    subject: 'Your Babes Stock email was changed',
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto">
        <h2 style="color:#7c3aed">Email address changed</h2>
        <p>Hi ${username},</p>
        <p>Your account email has been updated to <strong>${newEmail}</strong>.</p>
        <p style="color:#6b7280;font-size:13px">If you didn't make this change, contact your administrator immediately.</p>
      </div>
    `,
  });
}

export async function sendPasswordResetEmail(email: string, username: string, resetToken: string) {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
  const resetUrl = `${appUrl}/reset-password?token=${resetToken}`;

  const transporter = getTransporter();
  await transporter.sendMail({
    from: `"Babes Stock" <${process.env.GMAIL_USER}>`,
    to: email,
    subject: 'Reset your Babes Stock password',
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto">
        <h2 style="color:#7c3aed">Reset your password</h2>
        <p>Hi ${username},</p>
        <p>Click the button below to reset your password. This link expires in <strong>1 hour</strong>.</p>
        <a href="${resetUrl}" style="display:inline-block;margin:16px 0;padding:12px 24px;background:#7c3aed;color:white;text-decoration:none;border-radius:8px;font-weight:600">Reset Password</a>
        <p style="color:#6b7280;font-size:13px">If you didn't request this, ignore this email.</p>
        <p style="color:#6b7280;font-size:12px">Link: ${resetUrl}</p>
      </div>
    `,
  });
}
