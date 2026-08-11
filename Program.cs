using Threnvale.Server.Data;
using Threnvale.Server.Networking;

var builder = WebApplication.CreateBuilder(args);

// Game data is loaded once at startup and shared read-only across all
// matches — DataStore itself is never mutated after LoadAll(), so it's
// safe as a singleton despite serving concurrent matches.
var dataStore = new DataStore(Path.Combine(AppContext.BaseDirectory, "Data", "GameData"));
dataStore.LoadAll();
builder.Services.AddSingleton(dataStore);
builder.Services.AddSingleton(new MatchManager(dataStore));

var app = builder.Build();

app.UseWebSockets();

// Health check — confirms the server is up and game data actually
// loaded, without requiring a WebSocket client to verify that.
app.MapGet("/health", (DataStore data) => Results.Ok(new
{
    status = "ok",
    kata_loaded = data.Kata.Count,
    characters_loaded = data.Characters.Count,
    items_loaded = data.Items.Count,
}));

// The actual PvP duel endpoint. Pairs the first two connections into a
// match — see MatchManager's doc comment for why both connections must
// stay alive (blocked) for the whole match.
app.Map("/ws/duel", async (HttpContext context, MatchManager matchManager) =>
{
    if (!context.WebSockets.IsWebSocketRequest)
    {
        context.Response.StatusCode = StatusCodes.Status400BadRequest;
        return;
    }
    using var socket = await context.WebSockets.AcceptWebSocketAsync();
    await matchManager.HandleConnectionAsync(socket, context.RequestAborted);
});

app.Run();

// Exposed for WebApplicationFactory-based integration tests.
public partial class Program { }
