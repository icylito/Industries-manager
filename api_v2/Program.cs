using api_v2.Model;
using api_v2.Endpoints;
using Microsoft.OpenApi;
using Microsoft.EntityFrameworkCore;
using static Microsoft.OpenApi.OpenApiSpecVersion;
using api_v2.Data;


var builder = WebApplication.CreateBuilder(args);
builder.Services.AddValidation(); //Validating all the required, range, and length in Dtos folder
builder.Services.AddOpenApi(options => 
options.OpenApiVersion = Microsoft.OpenApi.OpenApiSpecVersion.OpenApi3_0);
var connectionString = builder.Configuration.GetConnectionString("ApiV2");
builder.Services.AddDbContext<AppDbContext>(options => options.UseNpgsql(connectionString));
    
var app = builder.Build();
app.MapIndustries();
app.MapOpenApi();
app.UseSwaggerUI(options =>
{
    options.SwaggerEndpoint("/openapi/v1.json", "api_v2");
});

app.Run();
