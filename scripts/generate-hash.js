// Generate a bcrypt hash
import bcrypt from 'bcrypt';

const password = '1234';
const saltRounds = 10;

bcrypt.hash(password, saltRounds)
  .then(hash => {
    console.log('Generated hash for password:', password);
    console.log(hash);
  })
  .catch(err => {
    console.error('Error generating hash:', err);
  }); 