import nodemailer from "nodemailer";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const isEmail = s => typeof s === "string" && s.length <= 100 && EMAIL.test(s);

// SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS 가 모두 있어야 켜진다. 없으면 null (메일 없이 채팅만 동작)
export function makeMailer(env = process.env) {
  if (!env.SMTP_HOST || !env.SMTP_USER || !env.SMTP_PASS) return null;
  const port = Number(env.SMTP_PORT) || 465;
  const transport = nodemailer.createTransport({
    host: env.SMTP_HOST, port, secure: port === 465,
    auth: { user: env.SMTP_USER, pass: env.SMTP_PASS },
    connectionTimeout: 8000, greetingTimeout: 8000, socketTimeout: 8000
  });
  const from = env.MAIL_FROM || env.SMTP_USER;
  const replyTo = env.MAIL_REPLY_TO || env.SMTP_USER;
  return ({ to, text }) => transport.sendMail({
    from: `KSY <${from}>`, replyTo, to,
    subject: "[KSY] 남기신 메시지에 답장이 왔습니다 / Reply to your message",
    text: `${text}\n\n--\n이 메일에 바로 답장하시면 KSY에게 전달됩니다.\nReply to this email to reach KSY directly.`
  });
}
