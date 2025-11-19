import { S3Client, DeleteObjectCommand, ObjectCannedACL } from '@aws-sdk/client-s3'
import { Upload } from '@aws-sdk/lib-storage'

import type { S3Config } from '@config/index'

import { FileUploadCallback, FileDeleteCallback } from './types'

export const s3Service = (config: S3Config, prefix: string) => {
  const { AWS_BUCKET: Bucket } = config

  const { AWS_ENDPOINT, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, PROXY_S3, PUBLIC_MEDIA_URL } = config
  const s3 = new S3Client({
    credentials: {
      accessKeyId: AWS_ACCESS_KEY_ID,
      secretAccessKey: AWS_SECRET_ACCESS_KEY,
    },
    endpoint: AWS_ENDPOINT,
    forcePathStyle: true,
  })

  const uploadFile: FileUploadCallback = async ({ createReadStream, uniqueFilename, mimetype }) => {
    const s3Location = prefix.length > 0 ? `${prefix}/${uniqueFilename}` : uniqueFilename

    const params = {
      Bucket,
      Key: s3Location,
      ACL: ObjectCannedACL.public_read,
      ContentType: mimetype,
      Body: createReadStream(),
    }
    const command = new Upload({ client: s3, params })
    const data = await command.done()
    let { Location: location } = data
    if (!location) {
      throw new Error('File upload did not return `Location`')
    }

    if (!location.startsWith('https://') && !location.startsWith('http://')) {
      // Ensure the location has a protocol. Hetzner sometimes does not return a protocol in the location.
      location = `https://${location}`
    }

    if (PROXY_S3) {
      try {
        const targetUrl = new URL(PROXY_S3)
        const publicUrl = new URL(location)
        const needsHostRewrite =
          targetUrl.hostname === 'minio' || (!targetUrl.hostname.includes('.') && targetUrl.hostname !== 'localhost')
        publicUrl.hostname = needsHostRewrite ? 'localhost' : targetUrl.hostname
        if (targetUrl.port) {
          publicUrl.port = targetUrl.port
        }
        publicUrl.protocol = targetUrl.protocol
        location = publicUrl.toString()
      } catch (error) {
        // If rewriting fails, fall back to the original location
      }
    } else if (PUBLIC_MEDIA_URL) {
      // Use PUBLIC_MEDIA_URL to construct the public URL
      try {
        const publicMediaUrl = new URL(PUBLIC_MEDIA_URL)
        const s3Url = new URL(location)
        // Extract bucket, path, and file from the S3 location
        const pathParts = s3Url.pathname.split('/').filter(Boolean)
        const bucket = pathParts[0] || Bucket
        const path = pathParts.slice(1, -1).join('/')
        const file = pathParts[pathParts.length - 1]
        
        // Construct URL using PUBLIC_MEDIA_URL
        const publicPath = [bucket, path, file].filter(Boolean).join('/')
        location = `${PUBLIC_MEDIA_URL}/${publicPath}`
      } catch (error) {
        // If rewriting fails, fall back to the original location
      }
    }

    return location
  }

  const deleteFile: FileDeleteCallback = async (url) => {
    let { pathname } = new URL(url, 'http://example.org') // dummy domain to avoid invalid URL error
    pathname = pathname.substring(1) // remove first character '/'
    const prefix = `${Bucket}/`
    if (pathname.startsWith(prefix)) {
      pathname = pathname.slice(prefix.length)
    }
    const params = {
      Bucket,
      Key: pathname,
    }
    await s3.send(new DeleteObjectCommand(params))
  }

  return {
    uploadFile,
    deleteFile,
  }
}
