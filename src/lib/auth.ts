import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { compare } from "bcryptjs";
import { list } from "@vercel/blob";

export const { handlers, signIn, signOut, auth } = NextAuth({
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        const email = credentials?.email as string;
        const password = credentials?.password as string;
        if (!email || !password) return null;

        const userId = email.toLowerCase().replace(/[^a-z0-9]/g, "_");
        try {
          const { blobs } = await list({ prefix: `users/${userId}/profile.json` });
          if (blobs.length === 0) return null;

          const res = await fetch(blobs[0].url);
          const user = await res.json();
          const valid = await compare(password, user.passwordHash);
          if (!valid) return null;

          return { id: userId, email: user.email, name: user.name || email };
        } catch {
          return null;
        }
      },
    }),
  ],
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        token.userId = user.id;
      }
      return token;
    },
    session({ session, token }) {
      if (session.user) {
        session.user.id = token.userId as string;
      }
      return session;
    },
  },
  pages: {
    signIn: "/login",
  },
});
