"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateTeams = void 0;
const tier_service_1 = require("./tier.service");
const generateTeams = async (clubId, teamCount, tierType) => {
    const computed = await (0, tier_service_1.computeTier)(clubId, tierType);
    const sortedUsers = Object.entries(computed.scores)
        .sort((a, b) => b[1] - a[1])
        .map(([userId]) => userId);
    const teams = Array.from({ length: teamCount }, (_, index) => ({
        teamId: index + 1,
        members: [],
    }));
    let direction = 1;
    let current = 0;
    for (const userId of sortedUsers) {
        const currentTeam = teams[current];
        if (!currentTeam) {
            continue;
        }
        currentTeam.members.push(userId);
        if (teamCount === 1) {
            continue;
        }
        if (direction === 1) {
            if (current === teamCount - 1) {
                direction = -1;
            }
            else {
                current += 1;
            }
        }
        else if (current === 0) {
            direction = 1;
        }
        else {
            current -= 1;
        }
    }
    return { teams };
};
exports.generateTeams = generateTeams;
