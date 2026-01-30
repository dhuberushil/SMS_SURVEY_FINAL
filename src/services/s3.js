const { S3Client, PutObjectCommand, DeleteObjectsCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { v4: uuidv4 } = require('uuid');
require('dotenv').config();
const logger = require('../logger');

// Normalize environment values (strip accidental quotes and whitespace)
const rawBucket = process.env.S3_BUCKET || '';
const BUCKET = rawBucket.replace(/^\s*"?(.*?)"?\s*$/, '$1').trim() || null;
const REGION = (process.env.S3_REGION || '').trim() || undefined;

const isS3Enabled = Boolean(BUCKET);

if (!isS3Enabled) {
  logger.warn(
    'S3_BUCKET not set. S3 operations will be no-ops for local testing. Set S3_BUCKET and AWS credentials in production.'
  );
}

const s3 = isS3Enabled ? new S3Client({ region: REGION }) : null;

function makeKey(email, filename) {
  // Use the user's email as the folder/UID. Sanitize it to avoid unsafe characters
  // but avoid percent-encoding (e.g. encodeURIComponent) because the presigned
  // URL generation will encode percent signs and produce double-encoded values
  // like `%2540` for `@`. Allow `@` and `.` so the folder name reads like an email.
  const safeEmail = (email || 'unknown').toLowerCase().replace(/[^a-z0-9@._-]/g, '_');
  const id = uuidv4();
  const clean = (filename || 'file').replace(/[^a-zA-Z0-9._-]/g, '_');
  // Store files under images/{email}/ with a uuid prefix to avoid collisions.
  return `images/${safeEmail}/${id}_${clean}`;
}

async function presignPut({ key, contentType, expiresIn = 900 }) {
  // If S3 is not configured, return a mock response allowing local testing.
  if (!isS3Enabled) return null; // caller should handle null URL and upload differently in dev
  const cmd = new PutObjectCommand({ Bucket: BUCKET, Key: key, ContentType: contentType });
  const url = await getSignedUrl(s3, cmd, { expiresIn });
  return url;
}

async function generatePresignedUrls(email, files = []) {
  const results = [];
  for (const f of files) {
    const key = makeKey(email, f.name || f.filename || 'upload');
    const url = await presignPut({
      key,
      contentType: f.contentType || f.type || 'application/octet-stream',
    });
    if (!BUCKET) {
      // In dev mode return key and a null url so frontend can fallback to an alternative upload flow.
      results.push({
        key,
        url: null,
        contentType: f.contentType || f.type || 'application/octet-stream',
        mock: true,
      });
    } else {
      results.push({
        key,
        url,
        contentType: f.contentType || f.type || 'application/octet-stream',
      });
    }
  }
  return results;
}

async function deleteObjects(keys = []) {
  // If S3 not configured, treat delete as a no-op (useful for local testing)
  if (!isS3Enabled) {
    if (!keys || keys.length === 0) return { Deleted: [] };
    logger.warn('deleteObjects called with keys but S3_BUCKET not configured — skipping deletion.');
    return { Deleted: keys.map((Key) => ({ Key })) };
  }
  if (!keys || keys.length === 0) return { Deleted: [] };
  const objs = keys.map((k) => ({ Key: k }));
  const cmd = new DeleteObjectsCommand({ Bucket: BUCKET, Delete: { Objects: objs } });
  return await s3.send(cmd);
}

module.exports = { generatePresignedUrls, deleteObjects, makeKey, BUCKET, isS3Enabled };
