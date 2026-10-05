namespace api_v2.Auth;

// Who is making the request. There's no login yet, so everyone is "local" and an admin.
// When auth gets added, swap NoAuthUser for one that reads the signed in user, nothing else changes.
public interface ICurrentUser
{
    string Name { get; }
    bool IsAdmin { get; }
}

public class NoAuthUser : ICurrentUser
{
    public string Name => "local";
    public bool IsAdmin => true;
}

public static class AdminExtensions
{
    // Put on any endpoint that changes rules, history or settings
    public static TBuilder RequireAdmin<TBuilder>(this TBuilder builder) where TBuilder : IEndpointConventionBuilder
    {
        return builder.AddEndpointFilter(async (context, next) =>
        {
            var user = context.HttpContext.RequestServices.GetRequiredService<ICurrentUser>();
            if (!user.IsAdmin)
            {
                return Results.Problem("Only an admin can do this", statusCode: StatusCodes.Status403Forbidden,
                    title: "Not allowed");
            }
            return await next(context);
        });
    }
}
