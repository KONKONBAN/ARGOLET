import nodemailer from 'nodemailer';
import { AppError, type InvitationMessage, type Notifier } from '@argolet/app';

const PURPOSE: Record<string, { subject: string; lead: string }> = {
  VERIFY_CONTACT: {
    subject: 'Mã xác minh tài khoản ARGOLET',
    lead: 'Dùng mã sau để xác minh địa chỉ email và kích hoạt tài khoản ARGOLET của bạn.',
  },
  RESET_PASSWORD: {
    subject: 'Mã đặt lại mật khẩu ARGOLET',
    lead: 'Có yêu cầu đặt lại mật khẩu cho tài khoản ARGOLET gắn với email này.',
  },
  STEP_UP: {
    subject: 'Mã xác thực bổ sung ARGOLET',
    lead: 'Một thao tác quan trọng (phê duyệt hoặc chốt kỳ) cần bạn xác thực bổ sung.',
  },
};

const esc = (s: string) =>
  s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const mask = (email: string) => email.replace(/^(.).*(@.*)$/, '$1***$2');

function layout(title: string, bodyHtml: string): string {
  return `<!doctype html><html lang="vi"><body style="margin:0;background:#F5F7F8;font-family:Inter,Segoe UI,Arial,sans-serif;color:#172D3B">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" style="max-width:520px;background:#ffffff;border-radius:12px;border:1px solid #DFE7EB">
<tr><td style="padding:24px 28px;border-bottom:1px solid #DFE7EB;font-weight:700;font-size:18px;color:#0B2D48">ARGOLET</td></tr>
<tr><td style="padding:28px">
<h1 style="margin:0 0 12px;font-size:20px;color:#172D3B">${esc(title)}</h1>
${bodyHtml}
</td></tr>
<tr><td style="padding:16px 28px;border-top:1px solid #DFE7EB;font-size:12px;color:#536978">Email tự động từ ARGOLET. Nếu bạn không thực hiện yêu cầu này, hãy bỏ qua email.</td></tr>
</table></td></tr></table></body></html>`;
}

export interface MailConfig {
  smtpUrl: string;
  from: string;
  otpTtlMinutes: number;
}

/**
 * Delivers one-time codes and invitations over SMTP (any provider: Amazon SES, SendGrid,
 * Mailgun, Google Workspace, Zoho…). A failed delivery aborts the request so the user is told
 * to retry instead of waiting for a code that never arrives.
 */
export function createMailNotifier(cfg: MailConfig, log: (msg: string) => void): Notifier {
  const transport = nodemailer.createTransport(cfg.smtpUrl, {
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  } as never);
  const send = async (to: string, subject: string, text: string, html: string) => {
    try {
      await transport.sendMail({ from: cfg.from, to, subject, text, html });
    } catch (e) {
      log(`[mail] delivery to ${mask(to)} failed: ${e instanceof Error ? e.message : String(e)}`);
      throw new AppError('UNAVAILABLE', 'Chưa gửi được email lúc này. Vui lòng thử lại sau ít phút.');
    }
  };
  return {
    async sendCode(to, purpose, code) {
      if (!to.includes('@')) {
        throw new AppError('VALIDATION', 'Hiện ARGOLET gửi mã qua email. Vui lòng dùng địa chỉ email.', {
          field: 'contact',
        });
      }
      const p = PURPOSE[purpose] ?? { subject: 'Mã xác thực ARGOLET', lead: 'Mã xác thực của bạn:' };
      const text = `${p.lead}\n\nMã: ${code}\nMã có hiệu lực trong ${cfg.otpTtlMinutes} phút. Không chia sẻ mã này với bất kỳ ai.`;
      const html = layout(
        p.subject,
        `<p style="margin:0 0 20px;line-height:1.6">${esc(p.lead)}</p>
<div style="font-size:32px;font-weight:700;letter-spacing:8px;background:#EEF6F2;color:#087452;border-radius:10px;padding:16px;text-align:center">${esc(code)}</div>
<p style="margin:20px 0 0;font-size:13px;color:#536978">Mã có hiệu lực trong ${cfg.otpTtlMinutes} phút. Không chia sẻ mã này với bất kỳ ai, kể cả nhân viên ARGOLET.</p>`,
      );
      await send(to, `${p.subject}: ${code}`, text, html);
    },
    async sendInvitation(to: string, inv: InvitationMessage) {
      const subject = `${inv.inviter} mời bạn tham gia ${inv.organization} trên ARGOLET`;
      const text = `${inv.inviter} mời bạn tham gia ${inv.organization} với vai trò ${inv.roleLabel}.\n\nMã mời: ${inv.code}\nMở lời mời: ${inv.link}\n\nĐăng ký hoặc đăng nhập bằng chính email này rồi nhập mã mời. Lời mời có hiệu lực 7 ngày.`;
      const html = layout(
        'Lời mời tham gia không gian làm việc',
        `<p style="margin:0 0 16px;line-height:1.6"><b>${esc(inv.inviter)}</b> mời bạn tham gia <b>${esc(inv.organization)}</b> với vai trò <b>${esc(inv.roleLabel)}</b>.</p>
<p style="margin:0 0 8px;font-size:13px;color:#536978">Mã mời</p>
<div style="font-size:22px;font-weight:700;letter-spacing:2px;color:#0B2D48;margin-bottom:20px">${esc(inv.code)}</div>
<a href="${esc(inv.link)}" style="display:inline-block;background:#087452;color:#ffffff;text-decoration:none;font-weight:600;padding:12px 20px;border-radius:8px">Mở lời mời</a>
<p style="margin:20px 0 0;font-size:13px;color:#536978">Đăng ký hoặc đăng nhập bằng chính email này rồi nhập mã mời. Lời mời có hiệu lực 7 ngày.</p>`,
      );
      await send(to, subject, text, html);
    },
  };
}
