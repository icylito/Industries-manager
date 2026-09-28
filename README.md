# Starting 

- well to start things first go to `/angular` and `npm install` to get the packages most likely there are 4 packages you'd forget just do 
`npm approve-scripts <package>` which could look like this:
`npm approve-scripts @parcel/watcher` thats an example 
anyway thats all for angular as its just barebone. Pro tip `ssr=false` as this project uses a barebore and perferably skip git by doing this flag 
`--skip-git`

- for api_v2 its a dotnet project so you'd need to `dotnet build` its a bit more non linear as you'd need to get some packages make sure nuget 
as an extension is downloaded in vs code also make sure `.net install tool`, `c# dev kit`, and `c#` are all installed use this url for .net installation 
no need visual studio community https://dotnet.microsoft.com/en-us/download/dotnet/thank-you/sdk-10.0.401-windows-x64-installer
for the packages this projects only uses

```
- https://www.nuget.org/packages/Swashbuckle.AspNetCore/10.0.0
- https://www.nuget.org/packages/Microsoft.EntityFrameworkCore.Design/10.0.12
- https://www.nuget.org/packages/Npgsql.EntityFrameworkCore.PostgreSQL/10.0.2
- https://www.nuget.org/packages/dotnet-ef/10.0.12
```

and thats should be all to get started.