import bcrypt from 'bcryptjs';
import prisma from '~/prisma/prisma.client';

async function main() {
  const email = 'alice@example.com';
  let user = await prisma.user.findUnique({ where: { email } });

  if (!user) {
    const hash = await bcrypt.hash('password123', 10);
    user = await prisma.user.create({
      data: { name: 'alice', email, password: hash }
    });
    console.log(`Created user: ${user.email} (${user.id})`);
  } else {
    console.log(`Using existing user: ${user.email} (${user.id})`);
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

    await prisma.researchSpace.upsert({
      where: { id: `seed-space-${i}` },
      update: {},
      create: {
        id: `seed-space-${i}`,
        ownerId: user.id,
        name: s.name,
        researchObjective: s.researchObjective,
        createdAt,
        updatedAt,
        lastOpenedAt: updatedAt
      }
    });

    console.log(`  Created space: "${s.name}"`);
  }

  console.log(`\nSeeded ${spaces.length} spaces.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
