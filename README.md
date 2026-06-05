# Prakton Sikkharthi Forum Site

Dynamic website for Prakton Sikkharthi Forum, Shantirhat Islamia Secondary School.

## Run

```bash
npm start
```

Open `http://localhost:3000` for the website and `http://localhost:3000/admin` for the admin panel.

The app uses SQLite at `data/site.db`. On first run it creates the database and seeds it from `data/site.json`.

Default admin credentials:

```text
Username: admin
Password: admin123
```

Set `ADMIN_USER`, `ADMIN_PASSWORD`, or `PORT` in the environment to change those values.
