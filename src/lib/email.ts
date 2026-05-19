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
