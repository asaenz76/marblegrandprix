import "server-only";

const RESEND_API_URL = "https://api.resend.com/emails";
// Display name is the Marble Grand Prix brand; the sending address stays on
// the already-DNS-verified brohda.com domain that the Supabase Auth SMTP relay
// uses (see docs/DEPLOYMENT.md) so mail keeps delivering. Moving the sending
// address to notifications@marblegrandprix.com is a deploy prerequisite (that
// domain must be verified in Resend + Supabase SMTP first), not a code change.
const FROM_ADDRESS = "Marble Grand Prix <notifications@brohda.com>";

export interface SendEmailInput {
  to: string;
  subject: string;
  html: string;
}

// No-ops (rather than throwing) whenever RESEND_API_KEY isn't set, so local
// dev/CI need no real key. Swallows delivery errors too: a failed email must never fail the
// server action that triggered it (e.g. publishing a pool).
export async function sendEmail({ to, subject, html }: SendEmailInput): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return;

  try {
    const response = await fetch(RESEND_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from: FROM_ADDRESS, to, subject, html }),
    });

    if (!response.ok) {
      console.error("Resend email send failed", response.status, await response.text());
    }
  } catch (error) {
    console.error("Resend email send failed", error);
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export interface PoolPublishedEmailOption {
  label: string;
  teamName: string | null;
  logoUrl: string | null;
}

export interface PoolPublishedEmailFixture {
  homeTeamName: string;
  awayTeamName: string;
  homeTeamLogoUrl: string | null;
  awayTeamLogoUrl: string | null;
  competitionName: string | null;
  competitionLogoUrl: string | null;
  scheduledStartUtc: string;
}

export interface PoolPublishedEmailData {
  question: string;
  poolUrl: string;
  locksAt: string;
  options: PoolPublishedEmailOption[];
  fixture: PoolPublishedEmailFixture | null;
}

// UTC rather than any single reader's local time — an email has no browser
// to personalize into (unlike LocalDateTime in-app), and UTC is unambiguous
// for a recipient list that can span timezones.
function formatLockTime(iso: string): string {
  const formatted = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
  }).format(new Date(iso));
  return `${formatted} UTC`;
}

function teamLogoImg(logoUrl: string | null): string {
  if (logoUrl) {
    return `<img src="${escapeHtml(logoUrl)}" width="28" height="28" alt="" style="display:block;border-radius:50%;object-fit:contain;" />`;
  }
  return `<span style="display:block;width:28px;height:28px;border-radius:50%;background-color:#f5f5f5;"></span>`;
}

function buildMatchBlock(fixture: PoolPublishedEmailFixture): string {
  // Logo is only rendered when a real competitionLogoUrl exists — the empty
  // placeholder circle (used for team logos, where alignment against a
  // second team matters) was near-invisible against the white card here,
  // reading as "no badge at all" when a competition simply had no logo on
  // file. Skipping it entirely for a missing competition logo, rather than
  // showing a blank circle, means every render either shows a real logo or
  // just the name — never a dead placeholder.
  const competitionLine = fixture.competitionName
    ? `<tr><td colspan="3" style="padding-bottom:10px;">
         <table role="presentation" cellpadding="0" cellspacing="0"><tr>
           ${fixture.competitionLogoUrl ? `<td style="padding-right:8px;">${teamLogoImg(fixture.competitionLogoUrl)}</td>` : ""}
           <td style="font-size:13px;font-weight:600;color:#111111;">${escapeHtml(fixture.competitionName)}</td>
         </tr></table>
       </td></tr>`
    : "";

  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:4px;">
      ${competitionLine}
      <tr>
        <td style="width:42%;">
          <table role="presentation" cellpadding="0" cellspacing="0"><tr>
            <td style="padding-right:8px;">${teamLogoImg(fixture.homeTeamLogoUrl)}</td>
            <td style="font-size:14px;font-weight:600;color:#111111;">${escapeHtml(fixture.homeTeamName)}</td>
          </tr></table>
        </td>
        <td style="width:16%;text-align:center;font-size:12px;font-weight:600;color:#a3a3a3;">VS</td>
        <td style="width:42%;text-align:right;">
          <table role="presentation" cellpadding="0" cellspacing="0" align="right"><tr>
            <td style="font-size:14px;font-weight:600;color:#111111;">${escapeHtml(fixture.awayTeamName)}</td>
            <td style="padding-left:8px;">${teamLogoImg(fixture.awayTeamLogoUrl)}</td>
          </tr></table>
        </td>
      </tr>
    </table>
    <p style="margin:8px 0 0;font-size:12px;color:#a3a3a3;">${formatLockTime(fixture.scheduledStartUtc)} kickoff</p>
  `;
}

function buildOptionsBlock(options: PoolPublishedEmailOption[]): string {
  if (options.length === 0) return "";
  const rows = options
    .map(
      (option) => `
        <tr>
          <td style="padding:4px 0;">
            <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border:1px solid #e8e8e8;border-radius:10px;">
              <tr>
                ${option.logoUrl ? `<td style="padding:10px 0 10px 12px;width:32px;">${teamLogoImg(option.logoUrl)}</td>` : ""}
                <td style="padding:10px 12px;font-size:14px;font-weight:600;color:#111111;">${escapeHtml(option.label)}</td>
              </tr>
            </table>
          </td>
        </tr>
      `,
    )
    .join("");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:16px;">${rows}</table>`;
}

export function buildPoolPublishedEmail(data: PoolPublishedEmailData): { subject: string; html: string } {
  const safeQuestion = escapeHtml(data.question);
  const subject = data.fixture
    ? `${data.fixture.homeTeamName} vs ${data.fixture.awayTeamName}: ${data.question}`
    : `New pool: ${data.question}`;

  const origin = new URL(data.poolUrl).origin;
  const profileUrl = `${origin}/profile`;
  // A styled-text wordmark rather than an image asset: the old emailed logo
  // was the brohda "b." PNG, and there is no Marble Grand Prix logo image yet.
  // Text rebrands the email cleanly with zero asset dependency and renders
  // identically across clients (no image proxying or data: URI stripping to
  // worry about). Weight/spacing/navy mirror the in-app --font-logo wordmark;
  // the font-family falls back through system stacks since custom web fonts
  // are unreliable in email clients.

  const html = `
    <div style="background-color:#f5f5f5;padding:32px 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;">
        <tr>
          <td style="padding-bottom:20px;text-align:center;">
            <span style="display:inline-block;font-size:20px;font-weight:800;letter-spacing:-0.02em;color:#1b2a5c;">Marble Grand Prix</span>
          </td>
        </tr>
        <tr>
          <td style="background-color:#ffffff;border:1px solid #e8e8e8;border-radius:16px;padding:24px;">
            ${data.fixture ? buildMatchBlock(data.fixture) : ""}
            <p style="margin:20px 0 0;font-size:18px;line-height:1.4;font-weight:700;color:#111111;">${safeQuestion}</p>
            ${buildOptionsBlock(data.options)}
            <p style="margin:16px 0 0;font-size:13px;color:#737373;">Locks ${formatLockTime(data.locksAt)}</p>
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:24px;">
              <tr>
                <td align="center">
                  <a href="${data.poolUrl}" style="display:inline-block;background-color:#4f46e5;color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;padding:14px 32px;border-radius:999px;">View &amp; enter &rarr;</a>
                </td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td style="padding-top:20px;text-align:center;">
            <p style="margin:0;font-size:12px;color:#a3a3a3;">Don't want these emails? Turn them off in your <a href="${profileUrl}" style="color:#a3a3a3;text-decoration:underline;">profile settings</a>.</p>
          </td>
        </tr>
      </table>
    </div>
  `.trim();

  return { subject, html };
}
