import bcrypt from "bcryptjs";

const password = "admin123"; // change this if you want
const saltRounds = 10;

async function generateHash() {
  const hash = await bcrypt.hash(password, saltRounds);
  console.log("Plain password:", password);
  console.log("Password hash:", hash);
}

generateHash();
