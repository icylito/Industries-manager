# About

So this project is a minimal web app API that shows a list of industries kept in a database. You can search the list, and adding, editing, and deleting rows is being built step by step.

## Where things are

- Done: the list shows the data from the database, and the search works.
- In progress: adding and deleting only change the screen for now, they don't save yet.
- Next: saving new rows, editing, deleting, and edge cases.

# Starting

- Well, to start things, first go to `/angular` and run `npm install` to get the packages. Most likely there are 4 packages you'd forget, so do
`npm approve-scripts <package>`, which could look like this:
`npm approve-scripts @parcel/watcher`. That's an example.
Anyway, that's all for Angular, as it's barebone. Pro tip: use `ssr=false`, as this project uses a barebone app, and preferably skip git by using this flag:
`--skip-git`.

- For `api_v2`, it's a dotnet project, so you'd need to run `dotnet build`. It's a bit more non-linear, as you'd need to get some packages. Make sure NuGet
as an extension is downloaded in VS Code. Also make sure `.NET Install Tool`, `C# Dev Kit`, and `C#` are all installed. Use this URL for the .NET installation,
no need for Visual Studio Community: https://dotnet.microsoft.com/en-us/download/dotnet/thank-you/sdk-10.0.401-windows-x64-installer.
For the packages, this project only uses don't change the versions as if you picked a wrong version something may break or not depends on the version and your luck:

```
- https://www.nuget.org/packages/Swashbuckle.AspNetCore/10.0.0
- https://www.nuget.org/packages/Microsoft.EntityFrameworkCore.Design/10.0.12
- https://www.nuget.org/packages/Npgsql.EntityFrameworkCore.PostgreSQL/10.0.2
- https://www.nuget.org/packages/dotnet-ef/10.0.12
```

And that should be all to get started.


## Angular

So this folder uses Angular mainly to replace the Swagger UI from `api_v2/`. The 2 folders should not be merged, as they both handle different things: Angular handles project state, displaying the data safely, and a nice UI to handle everything more easily. It's not the prettiest yet, but it does the job!.

## Api_v2

So this folder is a minimal web app API that has a direct line of communication using **ConnectionString**, which is in `appsettings.Development.json`. Don't waste your time looking for it, I intentionally git ignored it since it holds private details. Well, I thought of giving dummy `.json` files so the setup would be easier and faster, but I left it out on purpose, so ask me and I'll share it.
