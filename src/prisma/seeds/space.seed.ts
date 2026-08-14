import { randomUUID } from 'crypto';

import bcrypt from 'bcryptjs';
import { env } from '~/config/enviroment';
import prisma from '~/prisma/prisma.client';

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

  const email = 'alice@example.com';
  let user = await prisma.user.findUnique({ where: { email } });

  if (!user) {
    const hash = await bcrypt.hash(env.SEED_USER_PASSWORD, 10);
    user = await prisma.user.create({
      data: { name: 'alice', email, password: hash }
    });
    console.log('Created user');
  } else {
    console.log('Using existing user');
  }

  const legacyCount = await prisma.researchSpace.deleteMany({
    where: { ownerId: user.id, id: { startsWith: 'seed-space-' } }
  });
  if (legacyCount.count > 0) {
    console.log(
      `Removed ${legacyCount.count} legacy space(s) with non-UUID ids.`
    );
  }

  const spaces = [
    {
      name: 'AI Ethics Research',
      researchObjective:
        'Explore ethical frameworks for AI decision-making in healthcare and autonomous vehicles.'
    },
    {
      name: 'Climate Change Analysis',
      researchObjective:
        'Analyze global temperature data and policy impacts on carbon emissions.'
    },
    {
      name: 'Quantum Computing Basics',
      researchObjective:
        'Understand qubit mechanics, superposition, and entanglement fundamentals.'
    },
    { name: 'Renaissance Art History', researchObjective: '' },
    {
      name: 'Urban Planning & Smart Cities',
      researchObjective:
        'Study IoT integration, traffic optimization, and sustainable infrastructure in modern cities.'
    },
    { name: 'Personal Notes', researchObjective: '' }
  ];

  const now = Date.now();

  for (let i = 0; i < spaces.length; i++) {
    const s = spaces[i];
    const daysAgo = i * 7;
    const createdAt = new Date(now - daysAgo * 24 * 60 * 60 * 1000);
    const updatedAt = new Date(
      now - Math.max(0, daysAgo - 1) * 24 * 60 * 60 * 1000
    );

    const existing = await prisma.researchSpace.findFirst({
      where: {
        ownerId: user.id,
        name: { equals: s.name, mode: 'insensitive' }
      }
    });

    const spaceData = {
      ownerId: user.id,
      name: s.name,
      researchObjective: s.researchObjective,
      createdAt,
      updatedAt,
      lastOpenedAt: updatedAt
    };

    if (existing) {
      await prisma.researchSpace.update({
        where: { id: existing.id },
        data: spaceData
      });
      console.log(`  Updated space: "${s.name}"`);
    } else {
      await prisma.researchSpace.create({
        data: { id: randomUUID(), ...spaceData }
      });
      console.log(`  Created space: "${s.name}"`);
    }
  }

  console.log(`\nSeeded ${spaces.length} spaces.`);
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
