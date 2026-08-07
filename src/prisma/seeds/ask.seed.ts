/**
 * Test data for the Ask / Chat interface.
 *
 * Creates one research space with four evidence sources whose text deliberately
 * overlaps and disagrees, so the flows the feature promises can actually be
 * observed: repeated findings across documents, a contradiction between two of
 * them, a claim that exists in only one source (which should trigger the
 * limitation banner), and page markers so citations render "Page N".
 *
 * Sources are created in `added` state and enqueued for ingestion, exactly as
 * the API does — the worker must be running (`yarn dev:worker`) and a working
 * embedding model configured, or they will never reach `ready` and the Ask
 * endpoint will refuse with NO_EVIDENCE.
 *
 *   yarn db:seed:ask
 *
 * Env:
 *   SEED_USER_PASSWORD  required — password for the seeded login
 *   SEED_USER_EMAIL     optional — defaults to alice@example.com
 */
import bcrypt from 'bcryptjs';

import { env } from '~/config/enviroment';
import prisma from '~/prisma/prisma.client';
import { enqueueIngestion } from '~/queues/ingestion.queue';

const SPACE_NAME = 'Aged-Care Operations';

/**
 * `[page N]` markers are what the PDF extractor leaves behind and what citation
 * page labels are derived from. Manual sources keep their text verbatim, so
 * including them here exercises that path without needing a real PDF.
 */
const SOURCES = [
  {
    title: 'Onboarding Benchmark Report',
    author: 'Product Research Group',
    content: [
      '[page 13]',
      'This benchmark surveyed 240 residential and in-home aged-care providers across four states. Responses were collected over eleven weeks and weighted by provider size.',
      '',
      '[page 14]',
      'Sixty-eight percent of surveyed providers maintain duplicate client information in at least three systems, contributing to delayed reporting and repeated data-entry checks. Providers describing their records as "fragmented" reported a median of 4.2 hours per week spent reconciling them.',
      '',
      '[page 15]',
      'Compliance reporting remains largely manual. Only nine percent of providers generate their quarterly quality indicator return without re-keying data by hand, and manual preparation was the single most cited source of reporting delay.',
      '',
      '[page 22]',
      'Information flow between field staff and office teams was rated poor or very poor by fifty-one percent of respondents. Field staff most often cited losing context between a home visit and the office record.'
    ].join('\n')
  },
  {
    title: 'Quality Standards Implementation Guide',
    author: 'Standards Authority',
    content: [
      '[page 4]',
      'This guide describes how providers are expected to demonstrate conformance with the quality standards. It emphasises process consistency: a provider must show that the same care decision would be made the same way, by any qualified staff member, on any day.',
      '',
      '[page 9]',
      'Fragmented record keeping is treated as a symptom rather than a root cause. Where records are inconsistent, assessors are directed to examine the underlying process design before recommending any system change.',
      '',
      '[page 11]',
      'Providers should not assume that consolidating systems resolves a conformance gap. Evidence gathered during assessments indicates that process definition, not tooling, accounts for the majority of repeat non-conformances.'
    ].join('\n')
  },
  {
    title: 'Interview Transcript 01 — Regional Provider',
    author: 'Field Research',
    content: [
      'Interviewer: Walk me through what happens after a home visit.',
      '',
      'Provider: The care worker writes it up on paper, because reception is unreliable out there. That paper comes back to the office the next day, sometimes two days later, and someone types it into the client record. So the record is always behind reality by at least a day.',
      '',
      'Interviewer: Does that cause problems?',
      '',
      'Provider: Constantly. If a nurse looks up a client in the morning she is reading yesterday. We had an incident where a medication change was recorded twice because two people typed up the same visit note.',
      '',
      'Interviewer: What would you change first?',
      '',
      'Provider: Honestly, one system. I know the standards people say it is a process problem. From where I sit, it is three systems that do not talk to each other, and my staff are the integration layer.'
    ].join('\n')
  },
  {
    title: 'Workforce Retention Brief',
    author: 'Sector Analysts',
    content: [
      'Turnover among direct care staff averaged 34 percent over the reporting year, up from 29 percent the year prior.',
      '',
      'Administrative burden is the second most commonly cited reason for leaving, behind pay. Staff who reported spending more than five hours per week on documentation were roughly twice as likely to indicate an intention to leave within twelve months.',
      '',
      'No provider in this sample had completed a consolidation of client record systems, so this brief cannot say whether consolidation affects retention.'
    ].join('\n')
  }
];

async function main() {
  if (env.NODE_ENV === 'production') {
    throw new Error(
      'Seed script refused to run against production environment.'
    );
  }
  if (!env.SEED_USER_PASSWORD) {
    throw new Error(
      'Missing required environment variable: SEED_USER_PASSWORD'
    );
  }

  const email = process.env.SEED_USER_EMAIL || 'alice@example.com';

  let user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    user = await prisma.user.create({
      data: {
        name: 'alice',
        email,
        password: await bcrypt.hash(env.SEED_USER_PASSWORD, 10)
      }
    });
    console.log(`Created user ${email}`);
  } else {
    console.log(`Using existing user ${email}`);
  }

  // Re-running should give a clean space rather than four more copies of every
  // source, so an existing seeded space is torn down first.
  const existing = await prisma.researchSpace.findFirst({
    where: { ownerId: user.id, name: SPACE_NAME }
  });

  if (existing) {
    const sourceIds = (
      await prisma.source.findMany({
        where: { researchSpaceId: existing.id },
        select: { id: true }
      })
    ).map((source) => source.id);

    // Citations reference sources, and notes reference citations, so the
    // dependents come out first.
    const citationIds = (
      await prisma.citation.findMany({
        where: { sourceId: { in: sourceIds } },
        select: { id: true }
      })
    ).map((citation) => citation.id);

    await prisma.noteCitation.deleteMany({
      where: { citationId: { in: citationIds } }
    });
    await prisma.citation.deleteMany({ where: { id: { in: citationIds } } });
    await prisma.note.deleteMany({ where: { researchSpaceId: existing.id } });
    await prisma.conversation.deleteMany({
      where: { researchSpaceId: existing.id }
    });
    await prisma.source.deleteMany({ where: { researchSpaceId: existing.id } });
    await prisma.notebook.deleteMany({
      where: { researchSpaceId: existing.id }
    });
    await prisma.researchSpace.delete({ where: { id: existing.id } });
    console.log(`Removed previous "${SPACE_NAME}" space`);
  }

  const space = await prisma.researchSpace.create({
    data: {
      ownerId: user.id,
      name: SPACE_NAME,
      researchObjective:
        'Understand why aged-care providers struggle with client records and compliance reporting, and what the evidence says about fixing it.'
    }
  });

  for (const source of SOURCES) {
    const created = await prisma.source.create({
      data: {
        researchSpaceId: space.id,
        sourceType: 'Manual',
        title: source.title,
        author: source.author,
        content: source.content,
        processingState: 'added'
      }
    });
    await enqueueIngestion(created.id);
    console.log(`  Queued source: ${source.title}`);
  }

  console.log('');
  console.log(`Space id: ${space.id}`);
  console.log(`Ask URL:  http://localhost:3000/spaces/${space.id}/ask`);
  console.log('');
  console.log(
    'Sources are queued. Run `yarn dev:worker` and wait for all four to reach ' +
      '`ready` before asking — the Ask endpoint returns NO_EVIDENCE until then.'
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect())
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  });
