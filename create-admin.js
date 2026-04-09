const { MongoClient } = require('mongodb');
const bcrypt = require('bcryptjs');
const { randomUUID } = require('crypto');

const MONGODB_URI =
  process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/rappidexexpress';

async function main() {
  const client = new MongoClient(MONGODB_URI);

  try {
    await client.connect();
    const db = client.db();

    const usersCollection = db.collection('user_entity');
    const citiesCollection = db.collection('city_entity');

    let city = await citiesCollection.findOne({
      name: 'Redenção',
      state: 'PA',
    });

    if (!city) {
      const cityResult = await citiesCollection.insertOne({
        name: 'Redenção',
        state: 'PA',
      });

      city = await citiesCollection.findOne({ _id: cityResult.insertedId });
    }

    const existing = await usersCollection.findOne({ user: 'admin' });

    if (existing) {
      console.log('Já existe um usuário admin.');
      console.log('Login: admin');
      console.log('Senha: 123456');
      return;
    }

    const passwordHash = await bcrypt.hash('123456', 10);

    await usersCollection.insertOne({
      id: randomUUID(),
      name: 'Administrador',
      phone: '94999999999',
      user: 'admin',
      password: passwordHash,
      profileImage: '',
      location: '',
      type: 'superadmin',
      permission: 'superadmin',
      pix: '',
      cityId: String(city._id),
      isActive: true,
      notification: {
        subscriptionId: '',
      },
      token: '',
      createdAt: new Date(),
      createdBy: 'create-admin-script',
      updatedAt: new Date(),
    });

    console.log('Admin criado com sucesso!');
    console.log('Login: admin');
    console.log('Senha: 123456');
  } catch (error) {
    console.error('Erro ao criar admin:', error);
  } finally {
    await client.close();
  }
}

main();