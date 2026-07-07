// one-time (idempotent) bucket cors setup so the browser can PUT to presigned
// urls from the admin page. run: npx tsx --env-file=.env.local scripts/r2-setup-cors.mts
import { AwsClient } from "aws4fetch";

const acct = process.env.R2_ACCOUNT_ID!;
const bucket = process.env.R2_BUCKET!;
const client = new AwsClient({
  accessKeyId: process.env.R2_ACCESS_KEY_ID!,
  secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
  service: "s3",
  region: "auto",
});

const cors = `<?xml version="1.0" encoding="UTF-8"?>
<CORSConfiguration>
  <CORSRule>
    <AllowedOrigin>https://www.andrewzhou.org</AllowedOrigin>
    <AllowedOrigin>https://andrewzhou.org</AllowedOrigin>
    <AllowedOrigin>http://localhost:3000</AllowedOrigin>
    <AllowedMethod>PUT</AllowedMethod>
    <AllowedHeader>content-type</AllowedHeader>
    <MaxAgeSeconds>3600</MaxAgeSeconds>
  </CORSRule>
</CORSConfiguration>`;

const url = `https://${acct}.r2.cloudflarestorage.com/${bucket}?cors`;
const res = await client.fetch(url, {
  method: "PUT",
  headers: { "Content-Type": "application/xml" },
  body: cors,
});
console.log("put cors:", res.status, res.ok ? "ok" : (await res.text()).slice(0, 300));

const check = await client.fetch(url);
console.log("get cors:", check.status);
console.log((await check.text()).slice(0, 400));
