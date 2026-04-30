import 'dotenv/config'
import crypto from 'crypto'
import pg from 'pg'

const { Client } = pg

const dbUrl = process.env.DB_URL
if (!dbUrl) {
  throw new Error('DB_URL is required')
}

const TEMP_PASSWORD = process.env.AUTH_SYNC_TEMP_PASSWORD || 'TempPass123!'

async function main() {
  const client = new Client({
    connectionString: dbUrl,
    ssl: { rejectUnauthorized: false },
  })
  await client.connect()

  try {
    const users = await client.query(
      `select id, email, display_name, role
       from public.users
       where email is not null and trim(email) <> ''
       order by id asc`,
    )

    let created = 0
    let skipped = 0

    for (const row of users.rows) {
      const email = String(row.email).trim().toLowerCase()
      const exists = await client.query(
        `select id from auth.users where lower(email) = $1 limit 1`,
        [email],
      )
      if (exists.rows[0]?.id) {
        const authUserId = String(exists.rows[0].id)
        await client.query(
          `insert into auth.identities
           (id, provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
           values
           (gen_random_uuid(), $1::text, $1::uuid,
            jsonb_build_object('sub', $1::text, 'email', $2::text, 'email_verified', true),
            'email', now(), now(), now())
           on conflict (provider_id, provider) do nothing`,
          [authUserId, email],
        )
        skipped += 1
        continue
      }

      const authUserId = crypto.randomUUID()
      await client.query(
        `insert into auth.users
         (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
          raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
         values
         ('00000000-0000-0000-0000-000000000000', $1, 'authenticated', 'authenticated', $2,
          crypt($3, gen_salt('bf')), now(),
          '{"provider":"email","providers":["email"]}'::jsonb,
          jsonb_build_object('display_name', $4::text, 'role', $5::text),
          now(), now())`,
        [authUserId, email, TEMP_PASSWORD, row.display_name || email.split('@')[0], row.role || 'staff'],
      )

      await client.query(
        `insert into auth.identities
         (id, provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
         values
         (gen_random_uuid(), $1::text, $1::uuid,
          jsonb_build_object('sub', $1::text, 'email', $2::text, 'email_verified', true),
          'email', now(), now(), now())`,
        [authUserId, email],
      )

      created += 1
      console.log(`Created auth user for ${email}`)
    }

    console.log(`Done. Created: ${created}, Skipped(existing): ${skipped}`)
    if (created > 0) {
      console.log(`Temporary password for newly-created auth users: ${TEMP_PASSWORD}`)
      console.log('Ask users to log in and change password immediately.')
    }
  } finally {
    await client.end()
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})

